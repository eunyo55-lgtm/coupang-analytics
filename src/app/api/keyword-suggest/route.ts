import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getServerSupabase } from '@/lib/agent/supabase-server'

/* ─────────────────────────────────────────────────────────
   /api/keyword-suggest
   - 시드(상품명/기존 키워드/카테고리)에서 키워드 후보 발굴
   - Claude로 시드 확장(있으면) → Naver RelKwdStat → 검색량 부착
   - 이미 등록된 키워드는 자동 제외
   ───────────────────────────────────────────────────────── */

const NAVER_API_URL = 'https://api.naver.com/keywordstool'
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

function makeSignature(timestamp: string, method: string, uri: string, secretKey: string): string {
  const msg = `${timestamp}.${method}.${uri}`
  return crypto.createHmac('sha256', secretKey).update(msg).digest('base64')
}

function getNaverCreds() {
  // 두 가지 명명 규칙 모두 지원
  const customerId    = process.env.NAVER_CUSTOMER_ID    || process.env.NAVER_AD_CUSTOMER_ID
  const accessLicense = process.env.NAVER_ACCESS_LICENSE || process.env.NAVER_AD_API_KEY
  const secretKey     = process.env.NAVER_SECRET_KEY     || process.env.NAVER_AD_SECRET_KEY
  return { customerId, accessLicense, secretKey }
}

async function naverRelKeywords(hintKeywords: string[]): Promise<Array<{
  keyword: string
  pc: number
  mobile: number
  total: number
  competition: string
}>> {
  const { customerId, accessLicense, secretKey } = getNaverCreds()
  if (!customerId || !accessLicense || !secretKey) return []
  const ts = Date.now().toString()
  const sig = makeSignature(ts, 'GET', '/keywordstool', secretKey)
  const params = new URLSearchParams({
    hintKeywords: hintKeywords.slice(0, 5).join(','),
    showDetail: '1',
  })
  const r = await fetch(`${NAVER_API_URL}?${params}`, {
    headers: {
      'X-Timestamp': ts,
      'X-API-KEY':   accessLicense,
      'X-Customer':  customerId,
      'X-Signature': sig,
      'Content-Type':'application/json',
    },
  })
  if (!r.ok) return []
  const j: any = await r.json()
  return (j.keywordList || []).map((it: any) => {
    const pc     = Number(it.monthlyPcQcCnt)     || 0
    const mobile = Number(it.monthlyMobileQcCnt) || 0
    // 일부 응답에서 "< 10" 같은 문자열이 오면 NaN → 0
    const total  = pc + mobile
    return {
      keyword: String(it.relKeyword || ''),
      pc, mobile, total,
      competition: total > 100000 ? 'high' : total > 30000 ? 'mid' : 'low',
    }
  }).filter((x: any) => x.keyword)
}

async function expandSeedsWithClaude(seeds: string[]): Promise<string[]> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return seeds
  if (seeds.length === 0) return seeds

  const sys = `너는 한국 키즈·유아·베이비 쇼핑몰 SEO 전문가야. 이 쇼핑몰은 **0~12세 어린이 상품만** 판매하므로, 성인용 키워드는 절대 만들지 마.

주어진 상품명/키워드/카테고리를 보고:
- 시즌 변형 (여름, 봄/가을, 사계절 등)
- 트렌드 변형 (인기, 베스트, 신상 등)
- 사용자 의도 변형 (추천, 후기, 비교 등)
- 타겟 변형 (유아, 베이비, 키즈, 여아, 남아, 아동, 초등 등)
- 연령/사이즈 변형 (3살, 5세, 100호, 110호 등 적절한 경우)
를 고려해 네이버 쇼핑에서 실제로 검색될 만한 한국어 키워드 후보를 만들어줘.

규칙:
1. 각 시드당 5~8개 후보 생성
2. **금지 키워드: "성인", "여성", "남성", "여자", "남자", "어른" 같은 단어 또는 그 변형 절대 사용 금지**
3. 모든 키워드는 반드시 아동/유아/베이비 대상이라는 것이 명확해야 함
4. 너무 일반적이지 않게 (예: "옷" X, "여아 원피스" O)
5. 한국어로만, 영문/특수문자 최소화
6. JSON 배열로만 응답 (다른 설명 없이): ["키워드1", "키워드2", ...]`

  const user = `시드: ${seeds.map(s => `"${s}"`).join(', ')}`

  try {
    const r = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: sys,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!r.ok) return seeds
    const j: any = await r.json()
    const text = j.content?.[0]?.text || ''
    // JSON 배열 추출
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return seeds
    const arr = JSON.parse(m[0])
    const expanded = Array.isArray(arr) ? arr.map(String).filter(Boolean) : []
    // 시드 + 확장본 합치되 중복 제거
    return Array.from(new Set([...seeds, ...expanded]))
  } catch {
    return seeds
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      seeds?: string[]
      excludeKeywords?: string[]
      useClaude?: boolean
      maxResults?: number
      kidsOnly?: boolean  // 키즈/유아/베이비 전용 필터 (성인 키워드 제외)
    }
    const seeds = (body.seeds || []).map(s => String(s || '').trim()).filter(Boolean)
    const exclude = new Set((body.excludeKeywords || []).map(s => String(s).toLowerCase().trim()))
    const useClaude = body.useClaude !== false  // 기본 true
    const maxResults = body.maxResults || 100
    const kidsOnly = body.kidsOnly !== false    // 기본 true
    // 성인 키워드 정규식: 어른/성인/여성/남성/여자/남자
    const adultPattern = /(성인|어른|여성|남성|여자|남자|female|male|adult|men|women)/i

    if (seeds.length === 0) {
      return NextResponse.json({ error: '시드 키워드가 필요합니다' }, { status: 400 })
    }

    // 1) Claude 시드 확장
    const expandedSeeds = useClaude ? await expandSeedsWithClaude(seeds) : seeds
    // 중복 제거 + 최대 25개 시드까지 (네이버 5개씩 배치 5번)
    const finalSeeds = Array.from(new Set(expandedSeeds)).slice(0, 25)

    // 2) Naver RelKwdStat 배치 (5개씩, 병렬 5)
    const batches: string[][] = []
    for (let i = 0; i < finalSeeds.length; i += 5) batches.push(finalSeeds.slice(i, i + 5))

    const allResults: Array<{
      keyword: string; pc: number; mobile: number; total: number; competition: string
      sourceSeed: string
    }> = []
    // 시드 → 결과 매핑을 위해 각 배치의 시드 추적
    await Promise.all(batches.map(async batch => {
      const r = await naverRelKeywords(batch)
      const seedLabel = batch.join(', ')
      r.forEach(item => allResults.push({ ...item, sourceSeed: seedLabel }))
    }))

    // 3) 중복 제거 (같은 키워드 있으면 검색량 큰 것 우선) + 제외 키워드 필터 + 성인 필터
    const byKw = new Map<string, typeof allResults[0]>()
    let adultFiltered = 0
    for (const it of allResults) {
      const key = it.keyword.toLowerCase().trim()
      if (!key || exclude.has(key)) continue
      // 키즈 전용 모드: 성인 패턴 매칭 시 제외
      if (kidsOnly && adultPattern.test(it.keyword)) {
        adultFiltered++
        continue
      }
      const prev = byKw.get(key)
      if (!prev || it.total > prev.total) byKw.set(key, it)
    }

    // 4) 검색량 내림차순 + 상한
    const baseSuggestions = Array.from(byKw.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, maxResults)

    // 5) 과거 검색량 조회 (7~14일 전) → WoW delta 계산
    //    keyword_search_volumes 테이블에서 prev week 값을 가져와 surge 판단
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const weekAgo = new Date(today.getTime() - 7 * 86400000)
    const twoWeeksAgo = new Date(today.getTime() - 14 * 86400000)
    const weekAgoStr = weekAgo.toISOString().slice(0, 10)
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().slice(0, 10)

    let prevByKw = new Map<string, number>()
    try {
      const sb = getServerSupabase()
      const kwList = baseSuggestions.map(s => s.keyword)
      if (kwList.length > 0) {
        // 7~14일 전 가장 최근 값 조회 (각 키워드별)
        const { data } = await sb
          .from('keyword_search_volumes')
          .select('keyword, total_volume, target_date')
          .in('keyword', kwList)
          .gte('target_date', twoWeeksAgoStr)
          .lte('target_date', weekAgoStr)
          .order('target_date', { ascending: false })
        // 각 키워드별 가장 최근 prev 값
        for (const row of (data || []) as any[]) {
          const k = String(row.keyword)
          if (!prevByKw.has(k)) prevByKw.set(k, Number(row.total_volume) || 0)
        }
      }
    } catch { /* prev volume 조회 실패 시 surge 비활성 */ }

    // 6) suggestion에 wowDelta + isSurging 부착
    const suggestions = baseSuggestions.map(s => {
      const prev = prevByKw.get(s.keyword)
      let wowDelta: number | null = null
      if (prev && prev > 0) {
        wowDelta = Math.round(((s.total - prev) / prev) * 100)
      }
      const isSurging = wowDelta !== null && wowDelta >= 30
      return { ...s, wowDelta, isSurging, prevVolume: prev || null }
    })

    // 7) 오늘 발굴된 모든 키워드의 현재 검색량을 keyword_search_volumes 에 upsert
    //    → 다음 발굴 때 prev 값으로 활용
    try {
      const sb = getServerSupabase()
      const rows = suggestions.map(s => ({
        keyword: s.keyword,
        mobile_volume: s.mobile,
        pc_volume: s.pc,
        total_volume: s.total,
        target_date: todayStr,
      }))
      if (rows.length > 0) {
        await sb.from('keyword_search_volumes').upsert(rows, {
          onConflict: 'keyword,target_date',
          ignoreDuplicates: false,
        })
      }
    } catch { /* upsert 실패해도 응답은 정상 진행 */ }

    return NextResponse.json({
      suggestions,
      seedCount: finalSeeds.length,
      claudeUsed: useClaude && !!process.env.ANTHROPIC_API_KEY,
      naverConfigured: !!getNaverCreds().secretKey,
      adultFiltered,
      surgingCount: suggestions.filter(s => s.isSurging).length,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '내부 오류' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

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

  const sys = `너는 한국 쇼핑몰 SEO 전문가야. 주어진 상품명/키워드/카테고리를 보고
- 시즌 변형 (2026 SS, 여름, 가을 등)
- 트렌드 변형 (인기, 베스트, 신상 등)
- 사용자 의도 변형 (추천, 후기, 비교 등)
- 타겟 변형 (여아용, 남아용, 베이비, 키즈 등 적절한 경우)
를 고려해 네이버 쇼핑에서 실제로 검색될 만한 한국어 키워드 후보를 만들어줘.

규칙:
1. 각 시드당 5~8개 후보 생성
2. 너무 일반적이지 않게 (예: "옷" X, "여아 원피스" O)
3. 한국어로만, 영문/특수문자 최소화
4. JSON 배열로만 응답 (다른 설명 없이): ["키워드1", "키워드2", ...]`

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
    }
    const seeds = (body.seeds || []).map(s => String(s || '').trim()).filter(Boolean)
    const exclude = new Set((body.excludeKeywords || []).map(s => String(s).toLowerCase().trim()))
    const useClaude = body.useClaude !== false  // 기본 true
    const maxResults = body.maxResults || 100

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

    // 3) 중복 제거 (같은 키워드 있으면 검색량 큰 것 우선) + 제외 키워드 필터
    const byKw = new Map<string, typeof allResults[0]>()
    for (const it of allResults) {
      const key = it.keyword.toLowerCase().trim()
      if (!key || exclude.has(key)) continue
      const prev = byKw.get(key)
      if (!prev || it.total > prev.total) byKw.set(key, it)
    }

    // 4) 검색량 내림차순 + 상한
    const suggestions = Array.from(byKw.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, maxResults)

    return NextResponse.json({
      suggestions,
      seedCount: finalSeeds.length,
      claudeUsed: useClaude && !!process.env.ANTHROPIC_API_KEY,
      naverConfigured: !!getNaverCreds().secretKey,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '내부 오류' },
      { status: 500 }
    )
  }
}

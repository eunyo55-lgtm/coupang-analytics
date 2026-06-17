import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/agent/supabase-server'

// Vercel Cron 매일 06:00 KST (= 21:00 UTC 전날)
// 등록된 키워드 + 상품 카테고리 기반 자동 발굴 → daily_keyword_suggestions 에 저장

export async function GET(req: NextRequest) {
  // 보호 — Vercel cron secret 또는 직접 호출 검증
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  try {
    const sb = getServerSupabase()
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

    // 1) 시드 후보 — 기존 keywords 의 카테고리 + 상품명에서
    const { data: kws } = await sb
      .from('keywords')
      .select('keyword, category, products(name)')
      .limit(300)
    const seedSet = new Set<string>()
    const existingSet = new Set<string>()
    for (const k of (kws || []) as any[]) {
      if (k.keyword) existingSet.add(String(k.keyword).toLowerCase().trim())
      if (k.category) seedSet.add(String(k.category).trim())
      if (k.products?.name) seedSet.add(String(k.products.name).trim())
    }
    const seeds = Array.from(seedSet).slice(0, 14)  // 14개 시드 (자동 모드 기본 ~8카테고리+6상품)
    if (seeds.length === 0) {
      return NextResponse.json({ error: 'no seeds available' }, { status: 400 })
    }

    // 2) 내부 발굴 API 호출
    const baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL
      || `https://${process.env.VERCEL_URL || 'coupang-analytics.vercel.app'}`
    const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
    const r = await fetch(`${url}/api/keyword-suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seeds,
        excludeKeywords: Array.from(existingSet),
        useClaude: true,
        kidsOnly: true,
        fashionOnly: true,
        strictAge: false,
        maxResults: 60,
      }),
    })
    if (!r.ok) {
      const err = await r.text().catch(() => '')
      return NextResponse.json({ error: `suggest API failed (${r.status}): ${err.substring(0,200)}` }, { status: 500 })
    }
    const j: any = await r.json()
    const suggestions = (j.suggestions || []) as Array<any>

    if (suggestions.length === 0) {
      return NextResponse.json({ ok: true, message: '발굴된 키워드 없음', date: todayStr })
    }

    // 3) 오늘 날짜 기존 row 삭제 (재실행 시 중복 방지)
    await sb.from('daily_keyword_suggestions').delete().eq('date', todayStr)

    // 4) 저장
    const rows = suggestions.map(s => ({
      date: todayStr,
      keyword: s.keyword,
      total_volume: s.total,
      pc_volume: s.pc,
      mobile_volume: s.mobile,
      competition: s.competition,
      source_seed: s.sourceSeed,
      has_age_token: !!s.hasAgeToken,
      is_surging: !!s.isSurging,
      wow_delta: s.wowDelta ?? null,
    }))

    const CHUNK = 500
    let inserted = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK)
      const { error } = await sb.from('daily_keyword_suggestions').insert(batch)
      if (error) {
        return NextResponse.json({ error: `insert failed: ${error.message}`, inserted }, { status: 500 })
      }
      inserted += batch.length
    }

    return NextResponse.json({
      ok: true,
      date: todayStr,
      seeds: seeds.length,
      inserted,
      ageMatched: rows.filter(r => r.has_age_token).length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}

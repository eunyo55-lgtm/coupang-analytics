// 랭킹 봇 트리거 API
// - POST  /api/trigger-ranking-bot           → 새 job 생성 (queue에 'pending'으로 INSERT)
// - GET   /api/trigger-ranking-bot           → 최근 jobs 목록 + 현재 상태
// - GET   /api/trigger-ranking-bot?id={uuid} → 특정 job 단건 조회 (진행상황 polling용)
//
// 회사 PC의 runner.js가 ranking_jobs 테이블을 polling 하다가 'pending' 발견 시
// 자동으로 봇(index.js)을 실행하고 결과를 같은 row에 update 한다.

import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { db: { schema: 'public' } })
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const supa = getSupa()
    const { data, error } = await supa
      .from('ranking_jobs')
      .insert({
        status: 'pending',
        triggered_by: typeof body?.triggered_by === 'string' ? body.triggered_by : 'web',
      })
      .select('id, status, created_at')
      .single()
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true, job: data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const supa = getSupa()
    if (id) {
      const { data, error } = await supa
        .from('ranking_jobs')
        .select('id, status, created_at, started_at, finished_at, triggered_by, error, logs')
        .eq('id', id)
        .single()
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ job: data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    // 목록 (최근 20개)
    const { data, error } = await supa
      .from('ranking_jobs')
      .select('id, status, created_at, started_at, finished_at, triggered_by, error')
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ jobs: data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

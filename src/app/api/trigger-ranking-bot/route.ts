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

const VALID_JOB_TYPES = ['coupang_rank', 'naver_volume'] as const
type JobType = typeof VALID_JOB_TYPES[number]

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawJobType = typeof body?.job_type === 'string' ? body.job_type : 'coupang_rank'
    const jobType: JobType = (VALID_JOB_TYPES as readonly string[]).includes(rawJobType)
      ? (rawJobType as JobType) : 'coupang_rank'

    const supa = getSupa()

    // 같은 종류 봇이 이미 pending/running이면 중복 트리거 차단
    const { data: active } = await supa
      .from('ranking_jobs')
      .select('id, status')
      .eq('job_type', jobType)
      .in('status', ['pending', 'running'])
      .limit(1)
    if (active && active.length > 0) {
      return new Response(
        JSON.stringify({ error: `이미 진행 중인 ${jobType} 작업이 있습니다 (${active[0].status})`, job: active[0] }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { data, error } = await supa
      .from('ranking_jobs')
      .insert({
        status: 'pending',
        job_type: jobType,
        triggered_by: typeof body?.triggered_by === 'string' ? body.triggered_by : 'web',
      })
      .select('id, status, job_type, created_at')
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

// 막힌 pending job 취소 (runner 오프라인일 때 사용자가 큐 정리)
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const supa = getSupa()
    if (id) {
      // 단건 취소
      const { error } = await supa
        .from('ranking_jobs')
        .update({ status: 'failed', error: 'cancelled by user', finished_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'pending')  // 이미 실행 중인 건 못 취소
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    // 전체 pending 취소
    const { error, count } = await supa
      .from('ranking_jobs')
      .update({ status: 'failed', error: 'cancelled by user', finished_at: new Date().toISOString() })
      .eq('status', 'pending')
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true, cancelled: count }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
        .select('id, status, job_type, created_at, started_at, finished_at, triggered_by, error, logs')
        .eq('id', id)
        .single()
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ job: data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    // 목록 (최근 20개). 쿼리에 ?job_type=... 있으면 필터.
    const jobTypeFilter = url.searchParams.get('job_type')
    let q = supa
      .from('ranking_jobs')
      .select('id, status, job_type, created_at, started_at, finished_at, triggered_by, error')
      .order('created_at', { ascending: false })
      .limit(20)
    if (jobTypeFilter && (VALID_JOB_TYPES as readonly string[]).includes(jobTypeFilter)) {
      q = q.eq('job_type', jobTypeFilter)
    }
    const { data, error } = await q
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ jobs: data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

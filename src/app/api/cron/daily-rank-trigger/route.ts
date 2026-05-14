// (2026-05-14부터 자동 cron 스케줄에서 빠짐 — vercel.json 참고)
// 두 종류 봇(coupang_rank, naver_volume) 작업을 ranking_jobs 큐에 적재한다.
// 회사 PC의 runner.js가 켜져 있으면 자동으로 잡아서 실행.
//
// 현재는 수동 트리거 전용:
//   - 평소: /ranking 페이지의 "데이터 수집" 버튼으로 사용자가 직접 클릭
//   - 필요 시: 이 endpoint를 curl로 직접 호출하면 양쪽 봇 동시 큐잉 가능
//             curl 'https://coupang-analytics.vercel.app/api/cron/daily-rank-trigger'
//   - 재차 자동 스케줄로 돌리고 싶으면 vercel.json crons에 다시 추가

import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { db: { schema: 'public' } })
}

export async function GET(req: Request) {
  // Vercel Cron 헤더 검증 (선택). 외부에서 임의로 호출 못 하게.
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const supa = getSupa()
    const jobs = ['coupang_rank', 'naver_volume'] as const
    const results: { job_type: string; ok: boolean; id?: string; reason?: string }[] = []

    for (const jobType of jobs) {
      // 같은 종류가 이미 pending/running이면 스킵 (중복 트리거 방지)
      const { data: active } = await supa
        .from('ranking_jobs')
        .select('id')
        .eq('job_type', jobType)
        .in('status', ['pending', 'running'])
        .limit(1)
      if (active && active.length > 0) {
        results.push({ job_type: jobType, ok: false, reason: 'already active', id: active[0].id })
        continue
      }
      const { data, error } = await supa
        .from('ranking_jobs')
        .insert({ status: 'pending', job_type: jobType, triggered_by: 'cron' })
        .select('id')
        .single()
      if (error) {
        results.push({ job_type: jobType, ok: false, reason: error.message })
      } else {
        results.push({ job_type: jobType, ok: true, id: data!.id })
      }
    }

    return new Response(JSON.stringify({ at: new Date().toISOString(), results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

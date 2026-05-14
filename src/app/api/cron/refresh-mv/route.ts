// Vercel Cron이 매일 호출 — 판매 KPI용 materialized view를 갱신한다.
//   mv_daily_kpi가 stale이면 대시보드 "전일/주간/누적 매출액"이 비어 보이는 문제 해결.
//
// 사전 작업 (Supabase SQL Editor에서 1회):
//   create or replace function public.refresh_kpi_mv()
//   returns json
//   language plpgsql
//   security definer
//   set search_path = public
//   as $$
//   declare
//     started_at  timestamptz := clock_timestamp();
//     finished_at timestamptz;
//   begin
//     refresh materialized view concurrently mv_daily_kpi;
//     finished_at := clock_timestamp();
//     return json_build_object(
//       'mv', 'mv_daily_kpi',
//       'started_at', started_at,
//       'finished_at', finished_at,
//       'duration_ms', extract(milliseconds from (finished_at - started_at))::int
//     );
//   end;
//   $$;
//   grant execute on function public.refresh_kpi_mv() to anon, authenticated;

import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 60  // refresh가 길어질 수 있어 1분 한도

function getSupa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { db: { schema: 'public' } })
}

export async function GET(req: Request) {
  // Vercel Cron 헤더 검증 (외부에서 임의 호출 차단). CRON_SECRET 미설정 시 검증 생략.
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const startedAt = new Date().toISOString()
  try {
    const supa = getSupa()
    const { data, error } = await supa.rpc('refresh_kpi_mv')
    if (error) {
      return new Response(JSON.stringify({
        ok: false,
        at: startedAt,
        error: error.message,
        hint: 'Supabase에 public.refresh_kpi_mv() 함수를 먼저 생성하세요 (route.ts 상단 주석 참고)',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true, at: startedAt, result: data }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, at: startedAt, error: e?.message ?? String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

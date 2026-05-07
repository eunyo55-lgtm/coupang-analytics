-- ============================================================
--  upsert_daily_sales: protect non-zero coupang_cost from 0-overwrite
-- ============================================================
--  기존 RPC는 새 row의 coupang_cost / stock 값을 그대로 덮어쓰는데,
--  파일에 해당 컬럼이 없으면 0이 들어와 기존 의미 있는 값을 지움.
--  이 패치는 새 값이 0일 때 기존 값을 유지하도록 변경.
--
--  ⚠️ 실행 전 주의: 이 함수의 정확한 시그니처는 환경마다 다를 수 있음.
--  Supabase SQL Editor에서 먼저 다음 명령으로 현재 함수 본문을 확인:
--
--    select pg_get_functiondef(oid) from pg_proc where proname = 'upsert_daily_sales';
--
--  현재 본문 + 아래 패턴을 합쳐 CREATE OR REPLACE 형태로 실행하세요.
-- ============================================================

create or replace function upsert_daily_sales(rows jsonb)
returns int
language plpgsql
as $$
declare
  rec jsonb;
  cnt int := 0;
begin
  for rec in select * from jsonb_array_elements(rows)
  loop
    insert into daily_sales (
      date, barcode, quantity, stock, coupang_cost,
      fc_quantity, vf_quantity, fc_stock, vf_stock, revenue
    ) values (
      (rec->>'date')::date,
      rec->>'barcode',
      coalesce((rec->>'quantity')::int, 0),
      coalesce((rec->>'stock')::int, 0),
      coalesce((rec->>'coupang_cost')::numeric, 0),
      coalesce((rec->>'fc_quantity')::int, 0),
      coalesce((rec->>'vf_quantity')::int, 0),
      0, 0, 0
    )
    on conflict (date, barcode) do update set
      -- quantity는 항상 새 값으로 (0이 정상 — 그 날 안 팔린 SKU)
      quantity     = excluded.quantity,
      -- stock도 새 값으로 (0 = 품절 = 의미 있는 정보)
      stock        = excluded.stock,
      -- coupang_cost: 새 값이 0이면 기존 값 유지 (cost 누락 파일이 0으로 덮지 못하게)
      coupang_cost = case
                       when excluded.coupang_cost > 0 then excluded.coupang_cost
                       else daily_sales.coupang_cost
                     end,
      fc_quantity  = excluded.fc_quantity,
      vf_quantity  = excluded.vf_quantity;

    cnt := cnt + 1;
  end loop;
  return cnt;
end
$$;

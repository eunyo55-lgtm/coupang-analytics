-- ============================================================
-- mv_daily_kpi 를 sale_price 기반으로 재정의
-- 대시보드 매출은 이 MV에서 옴 → sale_price 반영하려면 MV 수정 필수
-- ============================================================

-- 1) 먼저 현재 MV 정의 확인 (실행 전 점검)
--    Supabase SQL Editor에서:
--    select pg_get_viewdef('mv_daily_kpi'::regclass);

-- 2) MV 재정의 — total_revenue 계산에 sale_price 우선 사용 (없으면 cost 폴백)
DROP MATERIALIZED VIEW IF EXISTS mv_daily_kpi CASCADE;

CREATE MATERIALIZED VIEW mv_daily_kpi AS
SELECT
  ds.date,
  SUM(ds.quantity)                                                    AS total_qty,
  -- 판매가(sale_price) 우선, 0이면 원가(cost)로 폴백
  SUM(ds.quantity * COALESCE(NULLIF(p.sale_price, 0), p.cost, 0))     AS total_revenue
FROM daily_sales ds
LEFT JOIN products p ON p.barcode = ds.barcode
WHERE ds.quantity > 0
GROUP BY ds.date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_kpi_date ON mv_daily_kpi(date);

-- 3) MV 즉시 갱신
REFRESH MATERIALIZED VIEW mv_daily_kpi;

-- 4) RPC 점검 — get_kpi_by_date/range가 mv_daily_kpi.total_revenue 를 그대로 사용한다면 별도 변경 불필요
--    필요 시 다음으로 정의 확인:
--    select pg_get_functiondef(oid) from pg_proc where proname in ('get_kpi_by_date','get_kpi_by_range');

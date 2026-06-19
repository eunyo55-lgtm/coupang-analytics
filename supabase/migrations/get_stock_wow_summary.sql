-- 전체 재고 WoW 합산 (단일 row 반환 → PostgREST max-rows=1000 제한 우회)
-- 클라이언트는 이 함수 하나만 호출하면 모든 SKU 합산된 정확한 WoW% 받음
--
-- 사용:
--   supabase.rpc('get_stock_wow_summary') → [{ cur_total, prev_total, wow_pct }]

CREATE OR REPLACE FUNCTION get_stock_wow_summary()
RETURNS TABLE (
  cur_total  bigint,
  prev_total bigint,
  wow_pct    numeric
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cur  bigint;
  v_prev bigint;
BEGIN
  -- get_top_stock 의 기존 로직 재사용 — top_n 을 충분히 크게 (모든 SKU > 8천) 주어 전체 합산
  SELECT
    COALESCE(SUM(total_stock), 0),
    COALESCE(SUM(prev_week_stock), 0)
    INTO v_cur, v_prev
  FROM get_top_stock(top_n := 100000);

  RETURN QUERY
  SELECT
    v_cur,
    v_prev,
    CASE
      WHEN v_prev > 0 THEN ROUND((v_cur - v_prev)::numeric / v_prev * 100, 1)
      ELSE NULL::numeric
    END;
END;
$$;

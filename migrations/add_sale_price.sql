-- 판매/공급/재고 가격 분리 마이그레이션
-- 1) products 테이블에 sale_price 컬럼 추가
--    cost = 원가 (재고액 계산용, 그대로 유지)
--    sale_price = 판매가/시중가 (판매액 계산용, 신규)
--    공급가는 supply_status 테이블의 매입가 사용 (그대로 유지)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sale_price NUMERIC DEFAULT 0;

COMMENT ON COLUMN products.cost IS '원가 — 재고액 계산용';
COMMENT ON COLUMN products.sale_price IS '판매가/시중가 — 판매액 계산용 (어드민 데이터 시중가)';

-- 2) upsert_products RPC 업데이트 (이미 jsonb rows를 받는 형태라 sale_price도 자동 처리되도록)
--    기존 RPC를 살펴보고 sale_price 컬럼이 jsonb에 있으면 함께 upsert 되도록
CREATE OR REPLACE FUNCTION upsert_products(rows jsonb)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  affected INTEGER;
BEGIN
  INSERT INTO products (
    barcode, name, option_value, cost, sale_price,
    season, image_url, category, hq_stock, updated_at
  )
  SELECT
    (r->>'barcode')::text,
    (r->>'name')::text,
    (r->>'option_value')::text,
    COALESCE((r->>'cost')::numeric, 0),
    COALESCE((r->>'sale_price')::numeric, 0),
    (r->>'season')::text,
    (r->>'image_url')::text,
    (r->>'category')::text,
    COALESCE((r->>'hq_stock')::numeric, 0),
    NOW()
  FROM jsonb_array_elements(rows) r
  ON CONFLICT (barcode) DO UPDATE SET
    name = EXCLUDED.name,
    option_value = EXCLUDED.option_value,
    cost = COALESCE(NULLIF(EXCLUDED.cost, 0), products.cost),  -- 0이면 기존값 유지
    sale_price = COALESCE(NULLIF(EXCLUDED.sale_price, 0), products.sale_price),
    season = COALESCE(NULLIF(EXCLUDED.season, ''), products.season),
    image_url = COALESCE(NULLIF(EXCLUDED.image_url, ''), products.image_url),
    category = COALESCE(NULLIF(EXCLUDED.category, ''), products.category),
    hq_stock = EXCLUDED.hq_stock,
    updated_at = NOW();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

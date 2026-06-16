-- ============================================================
-- 대표 O코드 sale_price 를 옵션-level barcode 행에 전파
-- ============================================================
-- 어드민 CSV에서 대표 O코드(예: O73F11U)에 시중가가 들어가지만
-- daily_sales는 옵션-level barcode(예: O73F11UBR180)와 매칭.
-- → 옵션 row에 부모 sale_price 를 복사해야 매출 계산에 반영됨.
--
-- 가장 긴 prefix 매칭 우선 (예: O73F1과 O73F11U 둘 다 prefix면 O73F11U 선택)

-- 1) 안전 점검 — 영향받을 행 수 확인
SELECT
  COUNT(*) AS option_rows_to_update,
  COUNT(DISTINCT opt.barcode) AS unique_options
FROM products opt
JOIN products rep
  ON opt.barcode LIKE rep.barcode || '%'
  AND opt.barcode <> rep.barcode
WHERE rep.sale_price > 0
  AND (opt.sale_price IS NULL OR opt.sale_price = 0);

-- 2) 전파 UPDATE — 옵션 row 에 부모 sale_price 복사
WITH best_match AS (
  SELECT DISTINCT ON (opt.barcode)
    opt.barcode AS opt_barcode,
    rep.sale_price AS rep_sale_price
  FROM products opt
  JOIN products rep
    ON opt.barcode LIKE rep.barcode || '%'
    AND opt.barcode <> rep.barcode
  WHERE rep.sale_price > 0
    AND (opt.sale_price IS NULL OR opt.sale_price = 0)
  -- 가장 긴 prefix 매칭이 우선 (가장 구체적인 대표)
  ORDER BY opt.barcode, length(rep.barcode) DESC
)
UPDATE products p
SET sale_price = bm.rep_sale_price,
    updated_at = NOW()
FROM best_match bm
WHERE p.barcode = bm.opt_barcode;

-- 3) 결과 확인
SELECT
  COUNT(*) FILTER (WHERE sale_price > 0) AS sale_price_filled,
  COUNT(*) FILTER (WHERE cost > 0)        AS cost_filled,
  COUNT(*)                                 AS total_products
FROM products;

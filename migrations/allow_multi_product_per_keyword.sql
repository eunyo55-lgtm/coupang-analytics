-- ============================================================
-- keywords 테이블: 같은 키워드를 여러 상품에 연결 가능하게
-- ============================================================
-- 기존: UNIQUE (keyword) 또는 무제약 → 같은 키워드 두 번째 등록 실패
-- 변경: UNIQUE (keyword, coupang_product_id) → 다른 상품이면 OK

-- 1) 기존 단일 컬럼 unique 제약이 있으면 제거
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM   pg_constraint con
    JOIN   pg_class      cls ON cls.oid = con.conrelid
    WHERE  cls.relname = 'keywords'
      AND  con.contype = 'u'
      AND  array_length(con.conkey, 1) = 1
      AND  EXISTS (
        SELECT 1 FROM unnest(con.conkey) k
        WHERE (
          SELECT attname FROM pg_attribute
          WHERE attrelid = con.conrelid AND attnum = k
        ) = 'keyword'
      )
  LOOP
    EXECUTE format('ALTER TABLE keywords DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped unique constraint: %', c.conname;
  END LOOP;
END $$;

-- 2) 복합 UNIQUE 추가 — 같은 키워드 OK, 같은 키워드+같은 상품은 중복 차단
ALTER TABLE keywords
  DROP CONSTRAINT IF EXISTS keywords_keyword_product_unique;

ALTER TABLE keywords
  ADD CONSTRAINT keywords_keyword_product_unique
  UNIQUE (keyword, coupang_product_id);

COMMENT ON CONSTRAINT keywords_keyword_product_unique ON keywords IS
  '같은 키워드는 여러 상품에 연결 가능, 단 동일 (키워드, 상품) 조합은 중복 불가';

-- 키워드 ↔ 카테고리 카탈로그 매핑 컬럼 추가
-- coupang_category_catalog.id 는 INTEGER 타입이므로 catalog_id 도 INTEGER 로

ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS catalog_id INTEGER
  REFERENCES coupang_category_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_keywords_catalog_id ON keywords(catalog_id);

-- 자동 추정 결과인지 표시
ALTER TABLE keyword_rankings
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'bot';
COMMENT ON COLUMN keyword_rankings.source IS 'bot | inferred(카테고리 추정)';

-- ============================================================
-- 카테고리별 우리 상품 노출 추적 — 역방향 랭킹
-- 기존: 키워드 검색 → 우리 상품 순위
-- 신규: 카테고리 1페이지 → 우리 상품 위치
-- ============================================================

-- 1) 카테고리 카탈로그 (사용자가 관리하는 추적 대상 목록)
CREATE TABLE IF NOT EXISTS coupang_category_catalog (
  id            SERIAL PRIMARY KEY,
  category_path TEXT NOT NULL,             -- '패션의류 > 키즈의류 > 상의류 > 티셔츠'
  category_id   TEXT,                       -- 쿠팡 내부 카테고리 ID (URL 의 숫자)
  category_url  TEXT NOT NULL,              -- 전체 URL (예: https://www.coupang.com/np/categories/195530)
  active        BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category_url)
);

COMMENT ON TABLE coupang_category_catalog IS
  '추적할 쿠팡 카테고리 목록 — 봇이 매일 1페이지를 크롤링';

-- 2) 일별 카테고리 1페이지 스냅샷
CREATE TABLE IF NOT EXISTS coupang_category_rankings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id          INTEGER NOT NULL REFERENCES coupang_category_catalog(id) ON DELETE CASCADE,
  measured_date       DATE NOT NULL,
  position            INTEGER NOT NULL,    -- 1페이지 내 위치 (보통 1~60)
  coupang_product_id  TEXT NOT NULL,       -- 노출된 상품의 쿠팡 ID
  product_name        TEXT,                -- 노출된 상품명 (스크래핑)
  product_image       TEXT,
  vendor_name         TEXT,                -- 판매자명 (오즈키즈인지 확인용)
  is_our_product      BOOLEAN DEFAULT FALSE, -- 우리 keywords/products 와 매칭됨
  matched_barcode     TEXT,                 -- 매칭된 우리 SKU
  measured_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(catalog_id, measured_date, position)
);

CREATE INDEX IF NOT EXISTS idx_cat_rank_catalog_date
  ON coupang_category_rankings(catalog_id, measured_date DESC);
CREATE INDEX IF NOT EXISTS idx_cat_rank_ours
  ON coupang_category_rankings(measured_date DESC)
  WHERE is_our_product = TRUE;

COMMENT ON TABLE coupang_category_rankings IS
  '카테고리 1페이지 일별 스냅샷 — 봇이 채움. is_our_product=true 가 우리 노출';

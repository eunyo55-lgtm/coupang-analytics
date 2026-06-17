-- ============================================================
-- (A) 키워드 전략 태그 + 메모 컬럼
-- ============================================================
ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS strategy_tag TEXT,
  ADD COLUMN IF NOT EXISTS memo TEXT;

COMMENT ON COLUMN keywords.strategy_tag IS '전략 태그 — 신상/베스트/광고집중/방어/정리예정/테스트중';
COMMENT ON COLUMN keywords.memo IS '간략 메모 — 운영 노트, 전략 메모 등 자유 텍스트';

-- ============================================================
-- (B) 매일 아침 자동 발굴 결과 저장 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_keyword_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL,
  keyword         TEXT NOT NULL,
  total_volume    INTEGER NOT NULL DEFAULT 0,
  pc_volume       INTEGER DEFAULT 0,
  mobile_volume   INTEGER DEFAULT 0,
  competition     TEXT,
  source_seed     TEXT,
  has_age_token   BOOLEAN DEFAULT FALSE,
  is_surging      BOOLEAN DEFAULT FALSE,
  wow_delta       INTEGER,
  dismissed       BOOLEAN DEFAULT FALSE,  -- '관심없음' 표시
  registered      BOOLEAN DEFAULT FALSE,  -- 사용자가 등록함
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, keyword)
);

CREATE INDEX IF NOT EXISTS idx_daily_suggestions_date ON daily_keyword_suggestions(date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_suggestions_unhandled ON daily_keyword_suggestions(date DESC)
  WHERE dismissed = FALSE AND registered = FALSE;

COMMENT ON TABLE daily_keyword_suggestions IS '매일 아침 자동 발굴된 키워드 후보 — Vercel Cron 에서 채움';

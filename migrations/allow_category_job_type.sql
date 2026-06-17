-- ============================================================
-- ranking_jobs.job_type CHECK 제약에 'coupang_category' 추가
-- ============================================================
-- 현재: ('coupang_rank', 'naver_volume') 만 허용
-- 변경: 'coupang_category' 도 허용

-- 기존 CHECK 제약 자동 검색 후 제거
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    WHERE cls.relname = 'ranking_jobs'
      AND con.contype = 'c'
      AND con.conname LIKE '%job_type%'
  LOOP
    EXECUTE format('ALTER TABLE ranking_jobs DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped: %', c.conname;
  END LOOP;
END $$;

-- 새 CHECK 제약 추가
ALTER TABLE ranking_jobs
  ADD CONSTRAINT ranking_jobs_job_type_check
  CHECK (job_type IN ('coupang_rank', 'naver_volume', 'coupang_category'));

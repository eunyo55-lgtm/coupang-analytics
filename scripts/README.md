# 자동화 봇

GitHub Actions로 매일 1회 실행되는 데이터 수집 봇 2종.

## 봇 종류

### `naver-volume.mjs` — 네이버 검색량 봇
- `keywords` 테이블의 모든 키워드를 가져와서
- 네이버 검색광고 API(`api.naver.com/keywordstool`)로 PC/모바일 월간 검색량 조회
- `keyword_search_volumes` 테이블에 (keyword, target_date) 키로 upsert

### `coupang-rank.mjs` — 쿠팡 랭킹 봇
- `keywords` 테이블에서 `coupang_product_id`가 등록된 키워드 모두 조회
- 각 키워드로 쿠팡 검색 페이지를 fetch (최대 5페이지 = 360개)
- 해당 product_id의 노출 순위·평점·리뷰수 추출
- `keyword_rankings` 테이블에 오늘 날짜로 insert (재실행 시 같은 날짜 row 삭제 후 다시 insert)
- 5페이지 안에 못 찾으면 rank_position = 999

## 스케줄

`.github/workflows/daily-bots.yml`
- 매일 KST 오전 3시 (UTC 18:00) 자동 실행
- GitHub 저장소 → Actions → "Daily bots" → "Run workflow"로 수동 실행도 가능

## 필요한 GitHub Secrets

저장소 → Settings → Secrets and variables → Actions → "New repository secret":

| Secret 이름 | 값 | 어디서 |
|---|---|---|
| `SUPABASE_URL` | `https://vzyfygmzqqiwgrcuydti.supabase.co` | Supabase Dashboard → Project Settings → API |
| `SUPABASE_ANON_KEY` | `eyJ...` (anon public key) | 같은 위치 |
| `NAVER_CUSTOMER_ID` | 숫자 | 네이버 검색광고 → API 라이센스 관리 |
| `NAVER_ACCESS_LICENSE` | 라이센스 키 | 같은 위치 |
| `NAVER_SECRET_KEY` | 시크릿 키 | 같은 위치 (생성 시 1회만 표시 — 분실 시 재생성) |

## 로컬에서 테스트

```bash
# .env 파일 생성 (Git에는 push 안 됨)
cat > .env <<EOF
SUPABASE_URL=https://vzyfygmzqqiwgrcuydti.supabase.co
SUPABASE_ANON_KEY=...
NAVER_CUSTOMER_ID=...
NAVER_ACCESS_LICENSE=...
NAVER_SECRET_KEY=...
EOF

# 환경변수 로드 후 실행 (Linux/Mac/Git Bash)
export $(grep -v '^#' .env | xargs) && node scripts/naver-volume.mjs

# Windows PowerShell
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^=]+)=(.+)$') { Set-Item "env:$($Matches[1])" $Matches[2] }
}
node scripts/naver-volume.mjs
```

## 데이터 모델

### `keyword_search_volumes`
- (keyword, target_date) unique
- pc_volume / mobile_volume / total_volume

### `keyword_rankings`
- keyword_id (keywords FK)
- date
- rank_position (1-360, 또는 999=권외)
- rating (0~5, null 가능)
- review_count (null 가능)

## 모니터링

GitHub 저장소 → Actions 탭에서 각 실행의 로그 확인 가능. 실패 시 이메일 알림.

대시보드 "랭킹 현황" 탭에서 데이터가 매일 채워지는지 확인.

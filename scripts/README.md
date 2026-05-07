# 자동화 봇

데이터 수집 봇 2종. **하나는 자동, 하나는 로컬 실행**으로 분리되어 있습니다.

## 봇별 실행 방식

| 봇 | 실행 위치 | 이유 |
|---|---|---|
| `naver-volume.mjs` | GitHub Actions 자동 (매일 KST 03:00) | API 기반 — 어디서든 작동 |
| `coupang-rank.mjs` | **사용자 노트북 로컬** (수동 또는 작업 스케줄러) | 쿠팡 Akamai가 GitHub IP 차단 — 가정용 IP 필요 |

---

## 1. Naver 검색량 봇 — 자동 (해야 할 일 1번뿐)

### GitHub Secrets 5개 등록
저장소 → **Settings** → **Secrets and variables** → **Actions** → "New repository secret":

| Name | 값 |
|---|---|
| `SUPABASE_URL` | `https://vzyfygmzqqiwgrcuydti.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase Settings → API → anon public key |
| `NAVER_CUSTOMER_ID` | 네이버 검색광고 → API 사용 관리 |
| `NAVER_ACCESS_LICENSE` | 같은 위치 |
| `NAVER_SECRET_KEY` | 같은 위치 (생성 시 1회만 표시) |

등록 후 **Actions** 탭에서 "Daily Naver search volumes" → "Run workflow"로 즉시 테스트 가능.

이후 매일 KST 03:00에 자동 실행됨.

---

## 2. Coupang 랭킹 봇 — 로컬 실행

쿠팡은 Akamai bot protection을 사용해서 GitHub Actions IP 같은 datacenter IP를 차단합니다 (Access Denied 페이지 반환). **가정용 한국 IP에서 실행해야 합니다.**

### 설정 (1회만)

#### A. Node.js 설치
이미 설치돼 있으면 건너뛰세요. 아니면 https://nodejs.org/ 에서 LTS 버전 다운로드.
PowerShell에서 확인: `node --version` (v20 이상 권장)

#### B. 프로젝트 코드 가져오기
```powershell
cd C:\Users\<본인이름>\Documents
git clone https://github.com/eunyo55-lgtm/coupang-analytics.git
cd coupang-analytics
```

#### C. 의존성 설치
```powershell
npm install
npx playwright install chromium
```

#### D. .env 파일 생성
프로젝트 루트(`coupang-analytics/`)에 `.env` 파일 만들고:
```
SUPABASE_URL=https://vzyfygmzqqiwgrcuydti.supabase.co
SUPABASE_ANON_KEY=eyJ...실제값...
```

⚠️ `.env`는 `.gitignore`에 들어 있으므로 GitHub에 푸시되지 않습니다.

### 실행 (매번)

#### 옵션 1 — 더블클릭
탐색기에서 `scripts/run-coupang-local.bat` 더블클릭. 검은 창 열리고 진행 상황 출력. 끝나면 아무 키나 눌러 닫기.

#### 옵션 2 — PowerShell
```powershell
cd C:\Users\<본인이름>\Documents\coupang-analytics
.\scripts\run-coupang-local.ps1
```

#### 옵션 3 — Node 직접
```powershell
$env:SUPABASE_URL="https://vzyfygmzqqiwgrcuydti.supabase.co"
$env:SUPABASE_ANON_KEY="eyJ..."
node scripts/coupang-rank.mjs
```

### 매일 자동 실행하고 싶다면 — Windows 작업 스케줄러

1. 작업 스케줄러 열기 (Win+R → `taskschd.msc`)
2. 우측 "기본 작업 만들기"
3. 이름: "쿠팡 랭킹 봇" / 매일 / 시작 시간 (예: 03:00)
4. 동작: 프로그램 시작 → `C:\...\coupang-analytics\scripts\run-coupang-local.bat`
5. 노트북 켜져 있어야 실행됨 (꺼져 있으면 다음 켜질 때 1회만 실행)

---

## 보안 주의

- `.env` 파일은 절대 Git에 push 하지 마세요 (이미 `.gitignore`에 포함됨)
- `SUPABASE_ANON_KEY`는 Supabase의 **anon** key (공개 키)라 노출돼도 RLS 정책으로 보호됨. 다만 다른 사람과 공유하지는 마세요.

## 모니터링

Supabase에서:
```sql
-- 오늘 쿠팡 랭킹 집계
select 
  count(*) as total,
  sum(case when rank_position = 999 then 1 else 0 end) as out_of_range,
  sum(case when rank_position < 999 then 1 else 0 end) as ranked
from keyword_rankings
where date = (select max(date) from keyword_rankings);
```

`ranked > 0` 이면 정상 작동. `total = 0` 이면 봇 실행 안 됨. `out_of_range = total` 이면 차단됨 (이 경우 .env 확인 또는 다른 컴퓨터에서 시도).

---

## 미래 옵션 — 셀프 호스트 GitHub Runner

자동화를 더 원하면 본인 노트북에 GitHub Actions self-hosted runner를 설치해서 **매일 정해진 시간에 GitHub가 노트북에 작업 명령**하도록 할 수 있습니다.

1. 저장소 → Settings → Actions → Runners → "New self-hosted runner"
2. Windows / x64 선택, 표시되는 PowerShell 명령 그대로 실행
3. runner가 백그라운드 서비스로 등록됨
4. `.github/workflows/coupang-rank.yml` 추가하고 `runs-on: self-hosted` 설정

이건 좀 더 무거운 셋업이라 일단은 작업 스케줄러로 시작하고, 안정화되면 그때 옮기는 게 좋습니다.

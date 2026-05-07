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

## 추천 설정 — 두 컴퓨터에 GitHub Self-hosted Runner 설치

두 컴퓨터(집·회사 등) 모두에 runner를 등록하면 **둘 중 어느 하나라도 켜져 있는 시점에 GitHub가 자동으로 실행**합니다. 매일 켜져 있을 가능성이 높아 안정성이 크게 올라갑니다.

이미 `.github/workflows/daily-coupang.yml` 워크플로우가 들어 있고, `runs-on: self-hosted` 로 설정되어 있어서 runner만 등록하면 즉시 자동 실행됩니다.

### 1회 설정 (각 컴퓨터에서 ~10분)

#### Step A. 저장소에서 등록 토큰 받기
1. 저장소 → **Settings** (상단)
2. 좌측 메뉴 **Actions** → **Runners**
3. 우측 상단 초록색 **"New self-hosted runner"** 클릭
4. **Windows** + **x64** 선택
5. 화면에 PowerShell 명령 5~6개가 순서대로 표시됨 (Download → Configure → Run)
6. **이 페이지 닫지 말기** — 명령들을 그대로 복사해야 함

#### Step B. PowerShell 관리자 권한으로 열기

윈도우 시작 메뉴 → "PowerShell" 검색 → **"관리자 권한으로 실행"**

#### Step C. 명령 실행 (Step A에서 복사한 것을 순서대로)

대략 다음 순서:
```powershell
# 폴더 생성 + 다운로드
mkdir actions-runner; cd actions-runner
Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v.../actions-runner-win-x64-...zip -OutFile actions-runner.zip

# 압축 해제
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory("$PWD/actions-runner.zip", "$PWD")

# 등록 (URL과 토큰 입력 — 화면에 표시된 것 그대로 복사)
./config.cmd --url https://github.com/eunyo55-lgtm/coupang-analytics --token AAAAA...

# 백그라운드 서비스로 설치 (재부팅해도 자동 실행)
./svc.sh install   # Linux/Mac
# Windows의 경우:
./svc install
./svc start
```

설정 단계에서 묻는 질문은 모두 **Enter**로 기본값 사용:
- runner name: 컴퓨터 이름 (예: `home-laptop`, `office-desktop` 으로 구분 권장)
- additional labels: 그대로 Enter (라벨 `self-hosted`만 자동 부여)
- work folder: 그대로 Enter

#### Step D. 다른 컴퓨터에서도 동일하게
회사 데스크탑에서 Step A부터 다시 진행 (토큰은 1회용이므로 새로 받아야 함).

#### Step E. 등록 확인
저장소 → Settings → Actions → Runners 페이지에 **runner 2개가 초록색 dot (Idle)** 으로 보이면 성공.

### 매일 자동 실행

이제 별다른 작업 필요 없습니다. 매일 KST 21:00에:
- 둘 중 켜져 있는 컴퓨터가 작업 받아 실행
- 둘 다 꺼져 있으면 다음 날 정해진 시간에 다시 시도

**테스트**: Actions 탭 → **"Daily Coupang rankings (self-hosted)"** → **Run workflow** 클릭하면 즉시 실행됩니다.

### Self-hosted runner의 장단점

| 장점 | 단점 |
|---|---|
| 무료 | 컴퓨터 켜져 있어야 실행됨 |
| 가정용 IP라 Akamai 통과 | 매번 npm install + Playwright install 발생 (~3분) |
| 두 대로 안정성 ↑ | 컴퓨터 자원 일부 사용 (CPU 5~10%, ~5분) |

### 만약 둘 다 안정적으로 켜져 있지 않다면

옵션:
- 한국 거주민 IP 프록시 서비스 ($10~30/월) — Bright Data, Smartproxy 등
- 미니 PC 또는 라즈베리파이 + 가정용 인터넷 ($50~100 1회)
- 24/7 켜놓을 수 있는 회사 데스크탑이 있으면 거기 하나만 등록

프록시로 전환 원하시면 `coupang-rank.mjs`의 Playwright launch 옵션에 proxy 한 줄 추가하면 됩니다.

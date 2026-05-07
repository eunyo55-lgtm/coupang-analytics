@echo off
REM 쿠팡 랭킹 로컬 실행 (Windows)
REM 사용법: 이 폴더에서 더블클릭 또는 명령창에서 run-coupang-local.bat 입력
REM
REM 처음 실행 시:
REM  1. 같은 폴더에 .env 파일 만들고 아래 4개 값 입력
REM  2. npm install 실행해서 dependencies 설치
REM  3. npx playwright install chromium

setlocal

if not exist "%~dp0..\\.env" (
  echo [에러] %~dp0..\.env 파일이 없어요.
  echo .env 파일을 프로젝트 루트에 만들고 다음을 채워주세요:
  echo.
  echo SUPABASE_URL=https://vzyfygmzqqiwgrcuydti.supabase.co
  echo SUPABASE_ANON_KEY=eyJ...
  echo NAVER_CUSTOMER_ID=12345
  echo NAVER_ACCESS_LICENSE=...
  echo NAVER_SECRET_KEY=...
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0.."

REM .env 로드
for /f "tokens=1,* delims==" %%a in (.env) do (
  if not "%%a"=="" if not "%%a:~0,1%"=="#" set "%%a=%%b"
)

echo [coupang-local] start
node scripts/coupang-rank.mjs
echo [coupang-local] done
pause

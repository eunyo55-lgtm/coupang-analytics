# 쿠팡 랭킹 로컬 실행 (Windows PowerShell)
# 사용법: PowerShell에서 .\scripts\run-coupang-local.ps1 실행
#
# 처음 실행 시:
#   1. 프로젝트 루트에 .env 파일 만들기 (아래 형식)
#   2. npm install
#   3. npx playwright install chromium

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot ".env"

if (-not (Test-Path $EnvFile)) {
    Write-Host "[에러] $EnvFile 파일이 없습니다." -ForegroundColor Red
    Write-Host ""
    Write-Host "프로젝트 루트($ProjectRoot)에 .env 파일을 만들고 다음을 채워주세요:"
    Write-Host ""
    Write-Host "SUPABASE_URL=https://vzyfygmzqqiwgrcuydti.supabase.co"
    Write-Host "SUPABASE_ANON_KEY=eyJ..."
    Write-Host ""
    exit 1
}

# .env 로드
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#=][^=]*)=(.*)$') {
        $key = $Matches[1].Trim()
        $value = $Matches[2].Trim().Trim('"').Trim("'")
        Set-Item "env:$key" $value
    }
}

Set-Location $ProjectRoot

Write-Host "[coupang-local] start" -ForegroundColor Cyan
node scripts/coupang-rank.mjs
Write-Host "[coupang-local] done" -ForegroundColor Green

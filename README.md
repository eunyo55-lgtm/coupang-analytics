# 🚀 Coupang Analytics

쿠팡 채널 통합 관리 대시보드 — Next.js + Supabase + Vercel

---

## 🗂 프로젝트 구조

```
src/
├── app/
│   ├── api/
│   │   └── naver-keywords/route.ts   # 네이버 검색량 API 프록시
│   ├── dashboard/                    # 대시보드 페이지
│   ├── sales/                        # 판매 현황
│   ├── inventory/                    # 재고 현황
│   ├── supply/                       # 공급 현황
│   ├── ranking/                      # 랭킹 현황
│   ├── ad/                           # 광고 현황
│   ├── datamanage/                   # 데이터 관리
│   ├── layout.tsx                    # 루트 레이아웃 (Sidebar + DateFilterBar)
│   └── globals.css                   # 전역 스타일
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx               # 좌측 네비게이션
│   │   └── DateFilterBar.tsx         # 날짜 필터 바 (전체 탭 공통)
│   ├── charts/
│   │   └── SalesLineChart.tsx        # 꺾은선 차트 컴포넌트
│   └── ui/                           # 공통 UI 컴포넌트
├── hooks/
│   └── useAnalytics.ts               # 핵심 데이터 계산 훅
├── lib/
│   ├── store.tsx                     # 전역 상태 (React Context)
│   ├── supabase.ts                   # Supabase 클라이언트
│   ├── fileParser.ts                 # 파일 파싱 (xlsx/csv)
│   └── dateUtils.ts                  # 날짜 유틸
└── types/
    └── index.ts                      # TypeScript 타입 정의
```

---

## ⚡ 빠른 시작

### 1. 저장소 클론 & 패키지 설치
```bash
git clone https://github.com/your-repo/coupang-analytics
cd coupang-analytics
npm install
```

### 2. 환경 변수 설정
```bash
cp .env.local.example .env.local
# .env.local 파일을 열어 Supabase / Naver API 키 입력
```

### 3. Supabase 테이블 생성
Supabase 대시보드 → SQL Editor → `supabase-schema.sql` 내용 붙여넣고 실행

### 4. 개발 서버 실행
```bash
npm run dev
# http://localhost:3000
```

---

## 🗄 Supabase 설정

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성
2. Settings → API 에서 URL, anon key, service_role key 복사
3. SQL Editor에서 `supabase-schema.sql` 실행

**저장되는 데이터:**
| 테이블 | 설명 |
|--------|------|
| `rankings` | 쿠팡 랭킹 (날짜별 수동 입력) |
| `ad_entries` | 광고 성과 (날짜별 수동 입력) |
| `supply_items` | 공급 중 수량 |

---

## 🔍 네이버 검색 API 설정

1. [네이버 검색광고 API](https://searchad.naver.com) 접속
2. API 관리 → 액세스 라이선스 발급
3. `.env.local`에 `NAVER_CUSTOMER_ID`, `NAVER_ACCESS_LICENSE`, `NAVER_SECRET_KEY` 입력

> API 키가 없으면 랭킹 탭에서 데모 데이터로 동작합니다.

---

## 📁 파일 업로드 지원 형식

| 파일 | 필수 컬럼 (자동 감지) |
|------|----------------------|
| 이지어드민 상품마스터 | 상품명, 옵션, 재고 |
| 쿠팡 판매 데이터 | 상품명, 수량, 금액, 날짜 |
| 쿠팡 발주서 | 상품명, 수량 |
| 공급 중 수량 | 상품명, 수량 |

- xlsx / xls / csv 모두 지원
- 한글 EUC-KR 인코딩 자동 처리 (codepage 949)
- 컬럼명 자동 감지 (다양한 표기 지원)

---

## 🚀 Vercel 배포

```bash
# Vercel CLI 설치
npm i -g vercel

# 배포
vercel

# 환경 변수는 Vercel 대시보드 → Settings → Environment Variables에 추가
```

---

## 📊 주요 기능

- **전체 탭 공통 날짜 필터** — 오늘 / 전일 / 전주(금~목) / 이번 달 / 최근 30일 / 전체 / 직접 입력
- **대시보드** — 판매량, 매출, 재고, 공급 중 KPI + 꺾은선 차트 + TOP5
- **판매 현황** — 일별 추이 (꺾은선), 상품별 매출 비중 (도넛), 상세 테이블
- **재고 현황** — 소진 예상일 자동 계산, 발주 권장량, 긴급/주의/정상 상태 분류
- **공급 현황** — 입고 대기 현황
- **랭킹 현황** — 쿠팡 랭킹 수동 입력 + 네이버 키워드 검색량 API
- **광고 현황** — ROAS, ACoS, CTR 자동 계산

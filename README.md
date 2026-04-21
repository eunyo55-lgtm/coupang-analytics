# 🛒 Coupang Analytics - 재고 현황 개선 (최종)

## 🐛 수정된 문제

| # | 문제 | 원인 | 해결 |
|---|---|---|---|
| 1 | 대시보드 '전일 재고' 숫자 오류 | `fileParser.ts`에서 같은 날짜+바코드의 FC/VF164 재고를 **덮어쓰기**해서 센터 중 하나의 재고만 남음 | 재고값도 `+=` SUM 집계로 수정 |
| 2 | 재고 현황 탭 데이터 전혀 맞지 않음 | `useAnalytics.ts`가 `masterData.slice(0, 200)`으로 200개만 계산하고 쿠팡재고와 연결 안 됨 | `get_inventory_detail` RPC 신규 작성, 프론트 직접 호출 |
| 3 | 본사재고(이지어드민 가용재고) 저장 필드 없음 | products 테이블 스키마에 필드 없음 | `hq_stock` 컬럼 추가 + 업로드 매핑 추가 |
| 4 | 쿠팡 매입가와 상품마스터 원가 혼재 | 두 원가가 분리 저장되지 않고 `revenue` 계산에만 사용됨 | `daily_sales.coupang_cost` 컬럼 분리 저장, UI에 [마스터]/[쿠팡] 토글 추가 |

## 📁 파일 배치

Git repo의 다음 경로에 덮어쓰기:

```
coupang-analytics/
├── migration_inventory_fix.sql              ← Supabase SQL Editor에서 먼저 실행
└── src/
    ├── types/index.ts                       ← (types_index.ts 를 여기로)
    ├── lib/
    │   ├── fileParser.ts
    │   └── storage.ts
    └── app/_pages/
        ├── DashboardPage.tsx
        ├── DataManagePage.tsx
        └── InventoryPage.tsx
```

## 🚀 적용 순서

### 1️⃣ Supabase SQL Editor에서 마이그레이션 실행
`migration_inventory_fix.sql` 전체 내용 복사 → SQL Editor에서 실행. 포함 내용:
- `products.hq_stock` 컬럼 (본사재고)
- `daily_sales.coupang_cost` 컬럼 (쿠팡 매입가)
- `upsert_products`, `upsert_daily_sales` RPC 재정의
- `get_stock_summary` 재정의 (재고액 2종 동시 반환)
- `get_inventory_detail(p_from, p_to)` 신규 추가 (재고 현황 탭 전용)

검증 쿼리:
```sql
SELECT * FROM get_stock_summary();
```

### 2️⃣ 코드 파일 7개 교체 후 Git push → Vercel 자동 배포

### 3️⃣ **중요: 쿠팡 허브 파일 재업로드**
기존 `daily_sales.stock` 은 버그 있는 파서로 저장된 값이라 SUM 집계가 안 되어 있어. 그리고 `coupang_cost` 컬럼은 이제 막 만들어진 상태라 기존 행에는 모두 0이 들어있어.

**최소한 최신 1일치** (2026-04-20 파일) 를 `데이터 관리` 탭에서 재업로드하면 대시보드 전일 재고가 정상화됨. 기대값:
- 총 재고 ≈ **74,280개**
- 재고액(쿠팡 기준) ≈ **11.67억**

재고 추이나 과거 차트 정확도를 원하면 그 날짜까지 거슬러 재업로드 필요.

### 4️⃣ 이지어드민 상품마스터 업로드
가용재고 컬럼 후보: `가용재고`, `본사재고`, `hq_stock`, `가용수량`, `현재고`, `재고수량`. 업로드 후 로그에 `가용재고=[컬럼명]` 이 찍히는지 확인. 다르면 `DataManagePage.tsx:85`의 `hqStockCol` 후보 배열에 추가.

## 🎯 새 기능 사용법

### 대시보드 - 전일 재고 카드
- 기본: 쿠팡 매입가 기준 재고액
- 카드 하단 작은 **[마스터] [쿠팡]** 버튼으로 전환 가능

### 재고 현황 탭
- 상단 KPI 제거, 시즌 파이 + 카테고리 막대 차트
- 기간 필터 (7/14/30일 프리셋) + 카테고리 드롭다운
- **판매되지 않은 재고** 섹션 (기간 내 판매 0 & 재고 보유)
- 메인 테이블: 이미지 / 상품명(▶ 옵션 토글) / 본사재고 / 쿠팡재고 / 공급중 / 일평균판매 / 소진예상
- 오른쪽 상단 **[수량] [금액]** 토글 + 금액 모드일 때 **[마스터] [쿠팡]** 원가 소스 토글
- 50개 단위 페이지네이션, 컬럼 헤더 클릭 정렬

### 폴백 로직
원가 0 처리가 똑똑해서 한쪽 데이터만 있어도 깨지지 않음:
- 쿠팡 선택했는데 `coupang_cost=0`이면 → `products.cost`로 폴백
- 마스터 선택했는데 `products.cost=0`이면 → `coupang_cost`로 폴백

## 📐 get_inventory_detail RPC 계산 로직

| 필드 | 계산 |
|---|---|
| **쿠팡재고** | `daily_sales` 중 MAX(date) 행의 `stock` (센터별 SUM 됨) |
| **본사재고** | `products.hq_stock` |
| **공급중** | `supply_status`에서 `확정수량 - 입고수량` 바코드별 SUM (양수만) |
| **일평균판매** | 기간 내 `quantity` SUM ÷ 기간일수 |
| **소진예상일** | `(쿠팡재고 + 본사재고 + 공급중) ÷ 일평균판매` |
| **색상** | `<7일` 🔴 / `<14일` 🟡 / `이상` 🟢 / 판매 0 `—` |

## ✅ 작동 확인 체크리스트
- [ ] `SELECT * FROM get_stock_summary()` 결과가 `total_stock≈74280`, `stock_value_coupang≈11.67억`
- [ ] 대시보드 전일 재고 카드에 [마스터] [쿠팡] 버튼 표시
- [ ] 재고 현황 탭에 KPI 카드 없음, 시즌 파이 + 카테고리 막대 표시
- [ ] 금액 모드 선택 시 원가 소스 토글 노출
- [ ] 상품명 ▶ 클릭 시 옵션별 상세 펼쳐짐
- [ ] 판매되지 않은 재고 섹션에 데이터 채워짐

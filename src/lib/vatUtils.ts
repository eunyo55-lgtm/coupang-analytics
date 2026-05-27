// VAT 부가세 관련 유틸
// 사용자가 명시적으로 "매출, 재고액, 광고비/광고매출"을 부가세 별도로 보고 싶다고 함.
// 원가/매입가(B2B 공급가)는 이미 VAT 별도 관행이라 그대로 둠.

export const VAT_RATE = 0.1
const DIVISOR = 1 + VAT_RATE  // 1.1

/** 부가세 포함 금액 → 부가세 별도(공급가) 금액 */
export const vatExcluded = (amountInclVat: number): number => {
  const v = Number(amountInclVat) || 0
  return Math.round(v / DIVISOR)
}

/** 부가세 별도 금액 → 부가세 포함 금액 (역변환, 필요 시) */
export const vatIncluded = (amountExclVat: number): number => {
  const v = Number(amountExclVat) || 0
  return Math.round(v * DIVISOR)
}

/** UI 라벨 (작은 글씨 보조 텍스트용) */
export const VAT_LABEL = 'VAT 별도'

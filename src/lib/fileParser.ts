import * as XLSX from 'xlsx'
import type { SalesRow, ParseResult } from '@/types'

// ── Column auto-detection ──
const COL_CANDIDATES = {
  productName: ['SKU 명', 'SKU명', '상품명', 'productname', '노출상품명', '상품이름', 'item', '상품 명'],
  option:      ['옵션', 'option', '옵션명', '속성', '옵션 명'],
  barcode:     ['바코드', 'barcode', 'SKU Barcode', 'SKUBarcode', 'SKU ID', 'sku', 'SKU', '상품바코드'],
  // 주의: '주문수량'은 의도적으로 제외 — 출고/판매와 의미가 달라 데이터 일관성을 깸
  qty:         ['출고수량(판매량)', '출고수량', '판매수량', '판매 수량', '수량', 'qty', 'quantity'],
  price:       ['매입원가', '원가', '금액', 'price', '매출', '결제금액', '판매금액', '상품금액', '단가', '매입원가(쿠팡공급가)'],
  date:        ['날짜', '판매일', 'date', '주문일', '결제일', '주문날짜', '날짜(판매일)'],
  stock:       ['현재재고수량', '재고', 'stock', '현재고', '재고수량', '현재재고수량(쿠팡재고)'],
  isReturn:    ['반품', '취소', '환불', 'cancel', 'return', '상태'],
  supplyQty:   ['공급수량', '입고수량', '공급 수량'],
}

export function detectColumn(
  row: Record<string, unknown>,
  candidates: string[]
): string | null {
  if (!row) return null
  const keys = Object.keys(row)
  for (const c of candidates) {
    const found = keys.find(k =>
      k.replace(/\s/g, '').toLowerCase().includes(c.toLowerCase().replace(/\s/g, ''))
    )
    if (found) return found
  }
  return null
}

export function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return v
  return parseFloat(String(v).replace(/[,₩\s원]/g, '')) || 0
}

// ── CSV parser (handles BOM, quoted fields) ──
function csvParse(text: string): Record<string, unknown>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []
  // 탭/콤마 자동 감지
  const firstLine = lines[0]
  const tabCount   = (firstLine.match(/\t/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length
  const delimiter  = tabCount > commaCount ? '\t' : ','
  const split = (line: string) => csvSplit(line, delimiter)
  const headers = split(firstLine)
  return lines.slice(1).map(line => {
    const vals = split(line)
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => (obj[h.trim()] = (vals[i] || '').trim()))
    return obj
  })
}

function csvSplit(line: string, delimiter = ','): string[] {
  if (delimiter === '\t') return line.split('\t').map(v => v.trim())
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === delimiter && !inQuote) { result.push(cur); cur = '' }
    else cur += ch
  }
  result.push(cur)
  return result
}

// ── Main file parser ──
export async function parseFile(
  file: File,
  key: ParseResult['key']
): Promise<ParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        let data: Record<string, unknown>[]

        if (file.name.toLowerCase().endsWith('.csv')) {
          data = csvParse(e.target?.result as string)
        } else {
          const wb = XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), {
            type: 'array',
            codepage: 949,
          })
          const ws = wb.Sheets[wb.SheetNames[0]]
          data = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]
        }

        resolve({
          key,
          rows: data.length,
          columns: data[0] ? Object.keys(data[0]) : [],
          data,
        })
      } catch (err) {
        resolve({
          key,
          rows: 0,
          columns: [],
          data: [],
          error: err instanceof Error ? err.message : '파싱 오류',
        })
      }
    }

    if (file.name.toLowerCase().endsWith('.csv')) {
      reader.readAsText(file, 'UTF-8')
    } else {
      reader.readAsArrayBuffer(file)
    }
  })
}

// ── Summary/Total row detection ──
// 쿠팡/이지어드민 파일에는 흔히 "합계", "소계", "Total" 라벨의 집계 행이 섞여 있음.
// 이런 행은 일별 데이터가 아니라 누적/주간 합계라서 그대로 들어가면
// 특정 날짜(예: 주의 첫째 날)에 큰 폭으로 inflation이 발생함.
const SUMMARY_TOKENS = ['합계', '소계', '총계', '계 :', '계:', '총합', 'total', 'subtotal', 'grand', '전체', '평균']
function isSummaryValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  const s = String(v).trim().toLowerCase()
  if (!s) return false
  return SUMMARY_TOKENS.some(tok => s.includes(tok.toLowerCase()))
}
// 날짜 셀에 기간 표시(`~`, `to`, ` - `)가 있으면 합계 행으로 간주
function isRangeDateCell(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (t.includes('~')) return true
  if (/\d\s*-\s*\d{4}/.test(t)) return true   // "2026.04.13 - 2026.04.19"
  if (/\d\s+to\s+\d/i.test(t)) return true
  return false
}

// ── Wide-format detection & expansion ──
// 24/25년 쿠팡 파일은 피벗 형태: 1행=1바코드, 컬럼=날짜 (예: "01월 01일", "01월 02일", ...)
// 각 셀 값이 그 날짜의 출고수량. 이걸 long format(1행=1바코드×1날짜)으로 melt해야
// 기존 daily_sales 스키마와 RPC가 정상 작동.
const WIDE_DATE_HEADER_RE = /^\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*$/

export function isWideSalesFormat(s0: Record<string, unknown> | undefined): boolean {
  if (!s0) return false
  let cnt = 0
  for (const k of Object.keys(s0)) {
    if (WIDE_DATE_HEADER_RE.test(k)) cnt++
    if (cnt >= 30) return true   // 한 달치 이상이면 wide로 확정
  }
  return false
}

// 파일명에서 연도 추출: "2024_판매.xlsx", "쿠팡_25년.csv", "24년 매출" 등 지원
export function extractYearFromFilename(name: string): number | null {
  if (!name) return null
  const m4 = name.match(/(20\d{2})/)
  if (m4) return parseInt(m4[1], 10)
  const m2 = name.match(/(\d{2})\s*년/)
  if (m2) {
    const yy = parseInt(m2[1], 10)
    return yy < 50 ? 2000 + yy : 1900 + yy
  }
  return null
}

export function normalizeWideSalesData(
  raw: Record<string, unknown>[],
  year: number
): SalesRow[] {
  if (!raw.length) return []
  const s0 = raw[0]
  const barcodeCol = detectColumn(s0, COL_CANDIDATES.barcode)
  if (!barcodeCol) {
    console.warn('[parser] wide format: 바코드 컬럼 미발견 — 스킵')
    return []
  }

  // 날짜 컬럼 수집
  const dateCols: { key: string; mm: string; dd: string }[] = []
  for (const k of Object.keys(s0)) {
    const m = WIDE_DATE_HEADER_RE.exec(k)
    if (m) {
      dateCols.push({
        key: k,
        mm: m[1].padStart(2, '0'),
        dd: m[2].padStart(2, '0'),
      })
    }
  }
  if (!dateCols.length) return []

  console.log(`[parser] wide format: ${year}년 / ${dateCols.length}개 날짜 컬럼 / ${raw.length}행`)

  const result: SalesRow[] = []
  let dropped = 0
  for (const row of raw) {
    const barcode = String(row[barcodeCol] || '').trim()
    if (!barcode) { dropped++; continue }
    if (isSummaryValue(barcode)) { dropped++; continue }

    for (const dc of dateCols) {
      const qty = toNumber(row[dc.key])
      if (qty === 0) continue   // 0은 저장 안 함 (long format이 비어있는 것과 동일)
      // 유효 날짜인지 확인 (2월 30일 같은 거 방어)
      const date = `${year}-${dc.mm}-${dc.dd}`
      const dt = new Date(date + 'T00:00:00Z')
      if (isNaN(dt.getTime())) continue

      result.push({
        date,
        productName: barcode,
        option: barcode,
        qty,
        revenue: 0,
        isReturn: false,
        stock: 0,
        coupangCost: 0,
      })
    }
  }
  if (dropped > 0) console.log(`[parser] wide format: 빈 바코드 또는 합계 행 ${dropped}건 제외`)
  return result
}

// ── Sales data normalizer (쿠팡 허브 CSV 지원) ──
export function normalizeSalesData(
  raw: Record<string, unknown>[]
): SalesRow[] {
  if (!raw.length) return []
  const s0 = raw[0]

  const barcodeCol = detectColumn(s0, COL_CANDIDATES.barcode)
  const nameCol    = detectColumn(s0, COL_CANDIDATES.productName)
  const optCol     = detectColumn(s0, COL_CANDIDATES.option)
  const qtyCol     = detectColumn(s0, COL_CANDIDATES.qty)
  const priceCol   = detectColumn(s0, COL_CANDIDATES.price)
  const dateCol    = detectColumn(s0, COL_CANDIDATES.date)
  const retCol     = detectColumn(s0, COL_CANDIDATES.isReturn)

  console.log('[parser] 감지된 컬럼:', { barcodeCol, nameCol, qtyCol, priceCol, dateCol })

  const stockCol = detectColumn(s0, COL_CANDIDATES.stock)

  // ── Step 0: 합계/소계/Total 행 사전 제거 ──
  let droppedSummary = 0
  const cleaned = raw.filter(row => {
    if (!row) return false
    // 날짜·바코드·상품명·옵션 셀에 합계 토큰이 있으면 제외
    const dateVal = dateCol ? row[dateCol] : ''
    const bcVal   = barcodeCol ? row[barcodeCol] : ''
    const nameVal = nameCol ? row[nameCol] : ''
    const optVal  = optCol ? row[optCol] : ''
    if (isSummaryValue(dateVal) || isSummaryValue(bcVal) ||
        isSummaryValue(nameVal) || isSummaryValue(optVal)) {
      droppedSummary++
      return false
    }
    // 날짜 셀이 기간(`2026.04.13~2026.04.19` 등)으로 표기된 합계 행도 제외
    if (dateCol && isRangeDateCell(String(dateVal || ''))) {
      droppedSummary++
      return false
    }
    return true
  })
  if (droppedSummary > 0) {
    console.log(`[parser] 🧹 합계/소계 행 ${droppedSummary}건 제외`)
  }

  // ── Step 1: row별 파싱 ──
  const parsed = cleaned
    .filter(row => {
      const d = dateCol ? String(row[dateCol] || '') : ''
      return d.length > 0
    })
    .map(row => {
      const rawDate = dateCol ? String(row[dateCol] || '') : ''
      // 날짜 형식 정규화: YYYYMMDD → YYYY-MM-DD, YYYY.MM.DD → YYYY-MM-DD
      let date = rawDate.trim()
      if (/^\d{8}$/.test(date)) {
        date = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
      } else {
        date = date.substring(0, 10).replace(/[/.]/g, '-')
      }

      const qty   = toNumber(row[qtyCol || ''])
      const price = toNumber(row[priceCol || ''])
      const stock = stockCol ? toNumber(row[stockCol]) : 0
      const isReturn = retCol
        ? String(row[retCol]).includes('반품') || String(row[retCol]).includes('취소')
        : false

      const barcode = barcodeCol ? String(row[barcodeCol] || '').trim() : ''
      const name    = nameCol    ? String(row[nameCol] || barcode) : barcode

      return {
        date,
        productName: name || barcode || '상품',
        option:      barcode || (optCol ? String(row[optCol] || '') : ''),
        qty:         qty || 0,
        revenue:     price * (qty || 1),
        isReturn,
        stock,              // 현재재고수량
        coupangCost: price, // 쿠팡 매입원가 (재고액 계산용)
      }
    })
    // 날짜 형식이 유효하고, 바코드(option) 또는 상품명이 비어있지 않은 행만
    .filter(r => r.date && r.date.match(/^\d{4}-\d{2}-\d{2}$/) && (r.option || r.productName))

  // ── Step 2: 날짜 + 바코드(option) 기준으로 집계 ──
  // 쿠팡 허브 파일은 동일 날짜에 같은 바코드가 여러 row로 나올 수 있음
  //  - 센터가 여러 개(FC/VF164 등) → 센터별로 각각 row가 생성됨
  //  - 따라서 출고수량(qty)과 현재재고수량(stock) 모두 누적 합산(SUM)해야 함
  //    예: O37A14UBR00F → FC=3 + VF164=15 = 18개가 실제 총 재고
  //  - 매입원가(coupangCost)는 센터 무관하게 동일 → 0이 아닌 값으로 유지
  const aggMap = new Map<string, SalesRow>()
  for (const row of parsed) {
    const key = `${row.date}||${row.option}||${String(row.isReturn)}`
    const existing = aggMap.get(key)
    if (existing) {
      existing.qty     += row.qty                     // 출고수량 누적 합산
      existing.revenue += row.revenue                 // 매출 누적 합산
      existing.stock   = (existing.stock || 0) + row.stock  // 재고도 센터별 누적 합산
      // 매입원가: 이미 값이 있으면 유지, 없을 때만 새 값으로 채움 (0 덮어씀 방지)
      if (!existing.coupangCost && row.coupangCost) existing.coupangCost = row.coupangCost
    } else {
      aggMap.set(key, { ...row })
    }
  }

  return Array.from(aggMap.values())
}

import * as XLSX from 'xlsx'
import type { SalesRow, ParseResult } from '@/types'

// ── Column auto-detection ──
const COL_CANDIDATES = {
  productName: ['SKU 명', 'SKU명', '상품명', 'productname', '노출상품명', '상품이름', 'item', '상품 명'],
  option:      ['옵션', 'option', '옵션명', '속성', '옵션 명'],
  barcode:     ['바코드', 'barcode', 'SKU Barcode', 'SKUBarcode', 'SKU ID', 'sku', 'SKU', '상품바코드'],
  qty:         ['출고수량', '판매수량', '수량', 'qty', '주문수량', 'quantity', '판매 수량', '출고수량(판매량)'],
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

  // ── Step 1: row별 파싱 ──
  const parsed = raw
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
    .filter(r => r.date && r.date.match(/^\d{4}-\d{2}-\d{2}$/))  // 날짜 형식 유효한 행만

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

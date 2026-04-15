import * as XLSX from 'xlsx'
import type { SalesRow, ParseResult } from '@/types'

// ── Column auto-detection ──
const COL_CANDIDATES = {
  productName: ['상품명', 'productname', '노출상품명', '상품이름', 'item', '상품 명', 'SKU 명'],
  option:      ['옵션', 'option', '옵션명', '속성', '옵션 명'],
  barcode:     ['바코드', 'barcode', 'sku', 'SKU', 'SKUBarcode', 'SKU Barcode', '상품바코드'],
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
  const headers = csvSplit(lines[0])
  return lines.slice(1).map(line => {
    const vals = csvSplit(line)
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => (obj[h.trim()] = (vals[i] || '').trim()))
    return obj
  })
}

function csvSplit(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { result.push(cur); cur = '' }
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

  return raw
    .filter(row => {
      // 빈 행 제거
      const d = dateCol ? String(row[dateCol] || '') : ''
      return d.length > 0
    })
    .map(row => {
      const rawDate = dateCol ? String(row[dateCol] || '') : ''
      const date = rawDate.substring(0, 10).replace(/[/.]/g, '-') || ''
      const qty   = toNumber(row[qtyCol || ''])
      const price = toNumber(row[priceCol || ''])
      const isReturn = retCol
        ? String(row[retCol]).includes('반품') || String(row[retCol]).includes('취소')
        : false

      // 쿠팡 허브 파일: 바코드를 option으로, 상품명은 products 테이블에서 매핑
      const barcode = barcodeCol ? String(row[barcodeCol] || '') : ''
      const name    = nameCol    ? String(row[nameCol] || barcode) : barcode

      return {
        date,
        productName: name || barcode || '상품',
        option:      barcode || (optCol ? String(row[optCol] || '') : ''),
        qty:         qty || 0,
        revenue:     price * (qty || 1),
        isReturn,
      }
    })
    .filter(r => r.date && r.qty > 0)  // 출고수량 0인 행 제외
}

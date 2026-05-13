// 쿠팡 광고 일별 리포트 (CSV/XLSX) 파서
// 한글 헤더 → DB 컬럼명 매핑 후 정형화된 row 배열로 반환
import * as XLSX from 'xlsx'

// 쿠팡 광고 리포트 헤더 → coupang_ad_daily DB 컬럼 매핑
const HEADER_MAP: Record<string, string> = {
  '날짜':                       'date',
  '과금 방식':                  'billing_method',
  '판매방식':                   'sales_method',
  '광고유형':                   'ad_type',
  '캠페인 ID':                  'campaign_id',
  '캠페인명':                   'campaign_name',
  '광고그룹':                   'ad_group',
  '광고집행 상품명':            'ad_product_name',
  '광고집행 옵션ID':            'ad_option_id',
  '광고전환매출발생 상품명':    'conv_product_name',
  '광고전환매출발생 옵션ID':    'conv_option_id',
  '광고 노출 지면':             'ad_placement',
  '키워드':                     'keyword',
  '노출수':                     'impressions',
  '클릭수':                     'clicks',
  '광고비':                     'ad_cost',
  '클릭률':                     'ctr',
  '총 주문수(1일)':             'orders_1d',
  '직접 주문수(1일)':           'direct_orders_1d',
  '간접 주문수(1일)':           'indirect_orders_1d',
  '총 판매수량(1일)':           'units_1d',
  '직접 판매수량(1일)':         'direct_units_1d',
  '간접 판매수량(1일)':         'indirect_units_1d',
  '총 전환매출액(1일)':         'revenue_1d',
  '직접 전환매출액(1일)':       'direct_revenue_1d',
  '간접 전환매출액(1일)':       'indirect_revenue_1d',
  '총 주문수(14일)':            'orders_14d',
  '직접주문수(14일)':           'direct_orders_14d',
  '직접 주문수(14일)':          'direct_orders_14d',  // 공백 variation
  '간접 주문수(14일)':          'indirect_orders_14d',
  '총 판매수량(14일)':          'units_14d',
  '직접 판매수량(14일)':        'direct_units_14d',
  '간접 판매수량(14일)':        'indirect_units_14d',
  '총 전환매출액(14일)':        'revenue_14d',
  '직접 전환매출액(14일)':      'direct_revenue_14d',
  '간접 전환매출액(14일)':      'indirect_revenue_14d',
  '총광고수익률(1일)':          'roas_1d',
  '직접광고수익률(1일)':        'direct_roas_1d',
  '간접광고수익률(1일)':        'indirect_roas_1d',
  '총광고수익률(14일)':         'roas_14d',
  '직접광고수익률(14일)':       'direct_roas_14d',
  '간접광고수익률(14일)':       'indirect_roas_14d',
  '캠페인 시작일':              'campaign_start_date',
  '캠페인 종료일':              'campaign_end_date',
  '비고':                       'note',
}

const NUMERIC_FIELDS = new Set([
  'impressions', 'clicks', 'ad_cost', 'ctr',
  'orders_1d', 'direct_orders_1d', 'indirect_orders_1d',
  'units_1d', 'direct_units_1d', 'indirect_units_1d',
  'revenue_1d', 'direct_revenue_1d', 'indirect_revenue_1d',
  'orders_14d', 'direct_orders_14d', 'indirect_orders_14d',
  'units_14d', 'direct_units_14d', 'indirect_units_14d',
  'revenue_14d', 'direct_revenue_14d', 'indirect_revenue_14d',
  'roas_1d', 'direct_roas_1d', 'indirect_roas_1d',
  'roas_14d', 'direct_roas_14d', 'indirect_roas_14d',
])

const DATE_FIELDS = new Set(['date', 'campaign_start_date', 'campaign_end_date'])

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '' || v === '-') return 0
  const s = String(v).replace(/[%,\s]/g, '').trim()
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function toDateStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v).trim()
  if (!s || s === '-') return null
  // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // YYYYMMDD
  if (s.length === 8 && /^\d+$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  return null
}

export type CoupangAdRow = Record<string, string | number | null>

export interface ParseResult {
  rows: CoupangAdRow[]
  dates: string[]
  unknownHeaders: string[]  // 매핑 안 된 헤더 — 디버그용
  totalSourceRows: number
}

export async function parseCoupangAdCsv(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer()
  // xlsx 라이브러리는 CSV와 XLSX 모두 읽음. codepage 65001 = UTF-8.
  // BOM이 있는 UTF-8 CSV도 자동 처리.
  const wb = XLSX.read(buf, { type: 'array', codepage: 65001 })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return { rows: [], dates: [], unknownHeaders: [], totalSourceRows: 0 }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: null,
  })

  // 첫 row의 키들 중 매핑 안 된 것들 추출 (디버그용)
  const sourceHeaders = rawRows.length > 0 ? Object.keys(rawRows[0]) : []
  const unknownHeaders = sourceHeaders.filter(h => !(h.trim() in HEADER_MAP))

  const rows: CoupangAdRow[] = []
  const dateSet = new Set<string>()

  for (const r of rawRows) {
    const mapped: CoupangAdRow = {}
    for (const [korHeader, dbCol] of Object.entries(HEADER_MAP)) {
      // r 객체의 키에 양쪽 공백 가능 → trim 비교
      const matchKey = Object.keys(r).find(k => k.trim() === korHeader.trim())
      if (!matchKey) continue
      const value = r[matchKey]
      if (DATE_FIELDS.has(dbCol)) {
        mapped[dbCol] = toDateStr(value)
      } else if (NUMERIC_FIELDS.has(dbCol)) {
        mapped[dbCol] = toNumber(value)
      } else {
        const s = value != null ? String(value).trim() : ''
        mapped[dbCol] = s || null
      }
    }
    if (mapped.date) {
      rows.push(mapped)
      dateSet.add(mapped.date as string)
    }
  }

  return {
    rows,
    dates: Array.from(dateSet).sort(),
    unknownHeaders,
    totalSourceRows: rawRows.length,
  }
}

import { supabase } from '@/lib/supabase'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export interface PersistedData {
  masterData:   Record<string, unknown>[]
  salesData:    { date:string; productName:string; option:string; qty:number; revenue:number; isReturn:boolean }[]
  salesData24:  never[]
  salesData25:  never[]
  ordersData:   Record<string, unknown>[]
  supplyData:   Record<string, unknown>[]
  products:     never[]
  dateRangePreset?: string
  hasData: boolean
  stockSummary: { total_stock: number; stock_value: number }
  daily26: { date: string; qty: number }[]
  daily25: { date: string; qty: number }[]
  daily24: { date: string; qty: number }[]
  latestSaleDate: string
}

// fetch로 RPC 호출 — 일반용
async function rpcFetch(fn: string, params: Record<string,unknown> = {}) {
  if (typeof window === 'undefined') return []
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!res.ok) { console.warn(`[storage] RPC ${fn} error:`, res.status); return [] }
    return await res.json()
  } catch(e) { console.warn(`[storage] RPC ${fn}:`, e); return [] }
}

// 테이블 직접 페이지네이션 (1000행 제한 우회)
async function fetchAllPages(path: string, extraHeaders: Record<string,string> = {}) {
  if (typeof window === 'undefined') return []
  const all: Record<string,unknown>[] = []
  let offset = 0
  const PAGE = 1000
  while (true) {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}${sep}offset=${offset}&limit=${PAGE}`, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, ...extraHeaders }
    })
    if (!res.ok) break
    const data = await res.json()
    if (!data.length) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
    if (all.length > 300000) break
  }
  return all
}

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    const today = new Date().toISOString().slice(0, 10)
    const ninetyAgo = new Date()
    ninetyAgo.setDate(ninetyAgo.getDate() - 90)
    const from90 = ninetyAgo.toISOString().slice(0, 10)

    // 모든 데이터 병렬 로드
    const [stock, daily26, daily25, daily24, salesRaw, supplyRes, ordersRes] = await Promise.all([
      rpcFetch('get_stock_summary'),
      rpcFetch('get_daily_qty_by_year', { target_year: 2026 }),
      rpcFetch('get_daily_qty_by_year', { target_year: 2025 }),
      rpcFetch('get_daily_qty_by_year', { target_year: 2024 }),
      // daily_sales + products JOIN — 페이지네이션으로 전체 로드
      fetchAllPages(
        `daily_sales?select=date,barcode,quantity&date=gte.${from90}&date=lte.${today}&quantity=gt.0&order=date.asc`
      ),
      supabase.from('supply_status')
        .select('"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"')
        .limit(5000),
      supabase.from('coupang_orders')
        .select('order_date,barcode,order_qty,confirmed_qty,received_qty,center')
        .order('order_date', { ascending: false })
        .limit(5000),
    ])

    // products 페이지네이션으로 전체 로드 (barcode→name 매핑용)
    const productsRaw = await fetchAllPages('products?select=barcode,name,option_value,cost&barcode=not.is.null&name=not.is.null&cost=gt.0')
    const barcodeMap = new Map<string, {name:string; option:string; cost:number}>()
    ;(productsRaw as Record<string,unknown>[]).forEach(r => {
      const bc = String(r['barcode'] || '')
      if (bc) barcodeMap.set(bc, { name: String(r['name']||bc), option: String(r['option_value']||''), cost: Number(r['cost']||0) })
    })

    // SalesRow 변환
    const salesData = (salesRaw as Record<string,unknown>[]).map(r => {
      const bc   = String(r['barcode'] || '')
      const info = barcodeMap.get(bc) || { name: bc, option: '', cost: 0 }
      const qty  = Number(r['quantity'] || 0)
      return {
        date:        String(r['date']),
        productName: info.name,
        option:      info.option,
        qty,
        revenue:     info.cost * qty,
        isReturn:    false,
      }
    })

    const stockSummary = (stock as Record<string,unknown>[])[0] ?? { total_stock: 0, stock_value: 0 }
    const d26 = (daily26 as Record<string,unknown>[]).map(r => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const d25 = (daily25 as Record<string,unknown>[]).map(r => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const d24 = (daily24 as Record<string,unknown>[]).map(r => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const latestSaleDate = d26.length > 0 ? d26[d26.length - 1].date : ''

    // masterData: 재고현황용 상품 목록
    const seen = new Set<string>()
    const masterData = salesData.reduce((acc: Record<string,unknown>[], r) => {
      if (!seen.has(r.productName)) {
        seen.add(r.productName)
        acc.push({ 상품명: r.productName, 옵션: r.option, 바코드: r.option })
      }
      return acc
    }, [])

    console.log('[CA] ✅ Supabase 로드 완료:', {
      sales90d: salesData.length,
      daily26: d26.length,
      daily25: d25.length,
      daily24: d24.length,
      stock: (stockSummary as Record<string,unknown>).total_stock,
      latestSaleDate,
    })

    return {
      salesData,
      salesData24: [] as never[],
      salesData25: [] as never[],
      masterData,
      products: [] as never[],
      ordersData: (ordersRes.data || []) as Record<string,unknown>[],
      supplyData: (supplyRes.data  || []) as Record<string,unknown>[],
      hasData: salesData.length > 0,
      dateRangePreset: 'yesterday',
      stockSummary: stockSummary as { total_stock: number; stock_value: number },
      daily26: d26, daily25: d25, daily24: d24,
      latestSaleDate,
    }
  } catch (e) {
    console.warn('[storage] loadData error:', e)
    return null
  }
}

export async function persistData(_data: PersistedData): Promise<void> {}
export async function clearData(): Promise<void> { console.log('[CA] clearData') }

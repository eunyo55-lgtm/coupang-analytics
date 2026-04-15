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

// fetch로 직접 RPC 호출 (1000행 제한 없음)
async function rpcFetch(fn: string, params: Record<string,unknown> = {}) {
  if (typeof window === 'undefined') return []
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const err = await res.text()
      console.warn(`[storage] RPC ${fn} error:`, res.status, err.substring(0,100))
      return []
    }
    return await res.json()
  } catch(e) {
    console.warn(`[storage] RPC ${fn} exception:`, e)
    return []
  }
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
      rpcFetch('get_sales_with_products', { date_from: from90, date_to: today }),
      supabase.from('supply_status')
        .select('"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"')
        .limit(5000),
      supabase.from('coupang_orders')
        .select('order_date,barcode,order_qty,confirmed_qty,received_qty,center')
        .order('order_date', { ascending: false })
        .limit(5000),
    ])

    // SalesRow 변환
    const salesData = (salesRaw as Record<string,unknown>[]).map(r => {
      const qty = Number(r['quantity'] || 0)
      const cost = Number(r['cost'] || 0)
      return {
        date:        String(r['sale_date']),
        productName: String(r['product_name'] || r['barcode'] || ''),
        option:      String(r['option_val'] || ''),
        qty,
        revenue:     cost * qty,
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

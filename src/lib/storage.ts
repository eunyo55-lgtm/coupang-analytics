import { supabase } from '@/lib/supabase'

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

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    const today = new Date().toISOString().slice(0, 10)
    const ninetyAgo = new Date()
    ninetyAgo.setDate(ninetyAgo.getDate() - 90)
    const from90 = ninetyAgo.toISOString().slice(0, 10)

    const [stockRes, daily26Res, daily25Res, daily24Res, productsRes, supplyRes, ordersRes, salesRes] = await Promise.all([
      supabase.rpc('get_stock_summary'),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2026 }),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2025 }),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2024 }),
      // products: barcode→name 매핑용 (원가 포함)
      supabase.from('products')
        .select('barcode, name, option_value, cost, current_stock, image_url')
        .not('barcode', 'is', null)
        .limit(5000),
      supabase.from('supply_status')
        .select('"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"')
        .limit(5000),
      supabase.from('coupang_orders')
        .select('order_date, barcode, order_qty, confirmed_qty, received_qty, center')
        .order('order_date', { ascending: false })
        .limit(5000),
      // 판매현황/재고현황용 — 최근 90일 원시 데이터
      supabase.from('daily_sales')
        .select('date, barcode, quantity')
        .gte('date', from90)
        .lte('date', today)
        .gt('quantity', 0)
        .order('date', { ascending: true }),
    ])

    // barcode → 상품명/원가 맵
    const barcodeMap = new Map<string, { name: string; option: string; cost: number }>()
    ;(productsRes.data || []).forEach((r: Record<string,unknown>) => {
      const bc = String(r['barcode'] || '')
      if (bc) barcodeMap.set(bc, {
        name:   String(r['name']         || bc),
        option: String(r['option_value'] || ''),
        cost:   Number(r['cost']         || 0),
      })
    })

    // daily_sales → SalesRow (판매현황/재고현황 페이지용)
    const salesData = (salesRes.data || []).map((r: Record<string,unknown>) => {
      const info = barcodeMap.get(String(r['barcode'])) || { name: String(r['barcode']), option: '', cost: 0 }
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

    const stockSummary = stockRes.data?.[0] ?? { total_stock: 0, stock_value: 0 }
    const daily26 = (daily26Res.data || []).map((r: Record<string,unknown>) => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const daily25 = (daily25Res.data || []).map((r: Record<string,unknown>) => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const daily24 = (daily24Res.data || []).map((r: Record<string,unknown>) => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const latestSaleDate = daily26.length > 0 ? daily26[daily26.length - 1].date : ''

    const masterData = (productsRes.data || []).map((r: Record<string,unknown>) => ({
      ...r, 상품명: r['name'], 옵션: r['option_value'], 바코드: r['barcode'], 재고: r['current_stock'],
    })) as Record<string,unknown>[]

    console.log('[CA] ✅ Supabase 로드 완료:', {
      sales90d: salesData.length,
      daily26: daily26.length,
      daily25: daily25.length,
      daily24: daily24.length,
      stock: stockSummary.total_stock,
      latestSaleDate,
    })

    return {
      salesData, salesData24: [] as never[], salesData25: [] as never[],
      masterData, products: [] as never[],
      ordersData: (ordersRes.data || []) as Record<string,unknown>[],
      supplyData: (supplyRes.data  || []) as Record<string,unknown>[],
      hasData: salesData.length > 0,
      dateRangePreset: 'yesterday',
      stockSummary, daily26, daily25, daily24, latestSaleDate,
    }
  } catch (e) {
    console.warn('[storage] loadData error:', e)
    return null
  }
}

export async function persistData(_data: PersistedData): Promise<void> {
  // 파일 업로드는 DataManagePage에서 직접 처리
}

export async function clearData(): Promise<void> {
  console.log('[CA] clearData')
}

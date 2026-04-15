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

    // 모든 데이터 병렬 로드
    const [stockRes, daily26Res, daily25Res, daily24Res, salesRes, supplyRes, ordersRes] = await Promise.all([
      supabase.rpc('get_stock_summary'),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2026 }),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2025 }),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2024 }),
      // get_sales_with_products RPC — products JOIN으로 1000행 제한 우회
      supabase.rpc('get_sales_with_products', { date_from: from90, date_to: today }),
      supabase.from('supply_status')
        .select('"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"')
        .limit(5000),
      supabase.from('coupang_orders')
        .select('order_date,barcode,order_qty,confirmed_qty,received_qty,center')
        .order('order_date', { ascending: false })
        .limit(5000),
    ])

    if (salesRes.error) console.warn('[storage] sales RPC error:', salesRes.error.message)

    // RPC 결과 → SalesRow 변환
    const salesData = (salesRes.data || []).map((r: Record<string,unknown>) => {
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

    const stockSummary = stockRes.data?.[0] ?? { total_stock: 0, stock_value: 0 }
    const daily26 = (daily26Res.data || []).map((r: Record<string,unknown>) => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const daily25 = (daily25Res.data || []).map((r: Record<string,unknown>) => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const daily24 = (daily24Res.data || []).map((r: Record<string,unknown>) => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) }))
    const latestSaleDate = daily26.length > 0 ? daily26[daily26.length - 1].date : ''

    // masterData: 상품명 기반 재고현황용
    const masterData = salesData
      .reduce((acc: Record<string,unknown>[], r) => {
        if (!acc.find((a: Record<string,unknown>) => a['상품명'] === r.productName)) {
          acc.push({ 상품명: r.productName, 옵션: r.option, 바코드: r.option })
        }
        return acc
      }, [])

    console.log('[CA] ✅ Supabase 로드 완료:', {
      sales90d: salesData.length,
      daily26: daily26.length,
      daily25: daily25.length,
      stock: stockSummary.total_stock,
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
      stockSummary, daily26, daily25, daily24, latestSaleDate,
    }
  } catch (e) {
    console.warn('[storage] loadData error:', e)
    return null
  }
}

export async function persistData(_data: PersistedData): Promise<void> {}
export async function clearData(): Promise<void> { console.log('[CA] clearData') }

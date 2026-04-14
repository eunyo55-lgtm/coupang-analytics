// Supabase 기반 저장/로드 — 파일 업로드 시 Supabase upsert, 앱 로드 시 Supabase에서 읽기
import { supabase } from '@/lib/supabase'
import type { SalesRow } from '@/types'

export interface PersistedData {
  masterData: Record<string, unknown>[]
  salesData:  SalesRow[]
  ordersData: Record<string, unknown>[]
  supplyData: Record<string, unknown>[]
  dateRangePreset?: string
  hasData: boolean
}

// ── Supabase에 업로드 (upsert) ──
export async function persistData(data: PersistedData): Promise<void> {
  if (typeof window === 'undefined') return

  const tasks: Promise<unknown>[] = []

  // 1. sales_data upsert (sale_date + sku 기준 중복 제거)
  if (data.salesData.length > 0) {
    const rows = data.salesData.map(r => ({
      sale_date:    r.date,
      product_name: r.productName,
      sku:          r.option || r.productName,
      quantity:     r.isReturn ? -(r.qty) : r.qty,
      amount:       r.revenue,
    }))
    // 배치 단위로 upsert (1000행씩)
    for (let i = 0; i < rows.length; i += 1000) {
      tasks.push(
        supabase.from('sales_data')
          .upsert(rows.slice(i, i + 1000), { onConflict: 'sale_date,sku' })
          .then(({ error }) => { if (error) console.warn('[storage] sales upsert error:', error.message) })
      )
    }
  }

  // 2. product_master upsert (바코드 또는 상품명+옵션 기준)
  if (data.masterData.length > 0) {
    const rows = data.masterData.map(r => ({
      상품명:     r['상품명'] || r['productName'] || '',
      옵션:       r['옵션']   || r['option']      || '',
      바코드:     r['바코드'] || r['sku']          || '',
      매장총재고: String(r['재고'] || r['현재고'] || r['매장총재고'] || '0'),
      원가:       Number(r['원가']  || 0),
      판매가:     Number(r['판매가'] || r['price'] || 0),
    })).filter(r => r['상품명'])
    for (let i = 0; i < rows.length; i += 1000) {
      tasks.push(
        supabase.from('product_master')
          .upsert(rows.slice(i, i + 1000), { onConflict: '상품명,옵션' })
          .then(({ error }) => { if (error) console.warn('[storage] master upsert error:', error.message) })
      )
    }
  }

  // 3. coupang_orders upsert
  if (data.ordersData.length > 0) {
    const rows = data.ordersData.map(r => ({
      order_date:     String(r['발주일'] || r['order_date'] || ''),
      barcode:        String(r['바코드'] || r['barcode'] || ''),
      order_qty:      Number(r['발주수량'] || r['order_qty'] || 0),
      confirmed_qty:  Number(r['확정수량'] || r['confirmed_qty'] || 0),
      received_qty:   Number(r['입고수량'] || r['received_qty'] || 0),
      center:         String(r['물류센터'] || r['center'] || ''),
    })).filter(r => r.barcode || r.order_date)
    for (let i = 0; i < rows.length; i += 1000) {
      tasks.push(
        supabase.from('coupang_orders')
          .insert(rows.slice(i, i + 1000))
          .then(({ error }) => { if (error) console.warn('[storage] orders insert error:', error.message) })
      )
    }
  }

  // 4. supply_status upsert
  if (data.supplyData.length > 0) {
    const rows = data.supplyData.map(r => ({
      '발주번호':    Number(r['발주번호'] || 0),
      'SKU ID':      Number(r['SKU ID'] || 0),
      'SKU 이름':    String(r['SKU 이름'] || r['상품명'] || ''),
      'SKU Barcode': String(r['SKU Barcode'] || r['바코드'] || ''),
      '물류센터':    String(r['물류센터'] || ''),
      '입고예정일':  String(r['입고예정일'] || ''),
      '발주일':      String(r['발주일'] || ''),
      '발주수량':    Number(r['발주수량'] || 0),
      '확정수량':    Number(r['확정수량'] || 0),
      '입고수량':    String(r['입고수량'] || '0'),
    }))
    for (let i = 0; i < rows.length; i += 1000) {
      tasks.push(
        supabase.from('supply_status')
          .upsert(rows.slice(i, i + 1000), { onConflict: '발주번호' })
          .then(({ error }) => { if (error) console.warn('[storage] supply upsert error:', error.message) })
      )
    }
  }

  await Promise.all(tasks)
  console.log('[CA] ✅ saved to Supabase:', {
    sales: data.salesData.length,
    master: data.masterData.length,
    orders: data.ordersData.length,
    supply: data.supplyData.length,
  })
}

// ── Supabase에서 로드 ──
export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    // 최근 6개월 판매 데이터 로드 (용량 관리)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const dateFrom = sixMonthsAgo.toISOString().slice(0, 10)

    const [salesRes, masterRes, ordersRes, supplyRes] = await Promise.all([
      supabase.from('sales_data')
        .select('sale_date, product_name, sku, quantity, amount')
        .gte('sale_date', dateFrom)
        .order('sale_date', { ascending: true })
        .limit(200000),
      supabase.from('product_master')
        .select('상품명, 옵션, 바코드, 매장총재고, 원가, 판매가')
        .limit(50000),
      supabase.from('coupang_orders')
        .select('order_date, barcode, order_qty, confirmed_qty, received_qty, center')
        .order('order_date', { ascending: false })
        .limit(10000),
      supabase.from('supply_status')
        .select('발주번호, "SKU 이름", "SKU Barcode", 입고예정일, 발주일, 발주수량, 확정수량, 입고수량')
        .limit(5000),
    ])

    if (salesRes.error) console.warn('[storage] sales load error:', salesRes.error.message)

    const salesData: SalesRow[] = (salesRes.data || []).map(r => ({
      date:        r.sale_date,
      productName: r.product_name,
      option:      r.sku || '',
      qty:         Math.abs(r.quantity || 0),
      revenue:     Number(r.amount || 0),
      isReturn:    (r.quantity || 0) < 0,
    }))

    const masterData = (masterRes.data || []) as Record<string, unknown>[]
    const ordersData = (ordersRes.data || []) as Record<string, unknown>[]
    const supplyData = (supplyRes.data || []) as Record<string, unknown>[]

    const hasData = salesData.length > 0 || masterData.length > 0

    if (hasData) {
      console.log('[CA] ✅ loaded from Supabase:', {
        sales: salesData.length, master: masterData.length,
        orders: ordersData.length, supply: supplyData.length,
      })
    }

    return { salesData, masterData, ordersData, supplyData, hasData, dateRangePreset: 'total' }
  } catch (e) {
    console.warn('[storage] loadData error:', e)
    return null
  }
}

export async function clearData(): Promise<void> {
  // Supabase 데이터는 앱에서 삭제 안 함 (의도적)
  console.log('[CA] clearData called — Supabase 데이터는 유지됩니다')
}

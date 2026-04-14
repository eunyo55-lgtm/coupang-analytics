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

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const dateFrom = sixMonthsAgo.toISOString().slice(0, 10)

    const [dailySalesRes, productsRes, supplyRes, ordersRes] = await Promise.all([
      // daily_sales: 실제 판매 데이터 (quantity > 0)
      supabase.from('daily_sales')
        .select('date, barcode, quantity, revenue, stock, fc_stock, vf_stock')
        .gte('date', dateFrom)
        .gt('quantity', 0)
        .order('date', { ascending: true })
        .limit(300000),
      // products: barcode → name, option_value, cost 매핑
      supabase.from('products')
        .select('barcode, name, option_value, cost, current_stock, safety_stock, season, hq_stock, fc_stock, vf_stock, incoming_stock, image_url')
        .not('barcode', 'is', null)
        .limit(50000),
      // supply_status
      supabase.from('supply_status')
        .select('"발주번호", "SKU 이름", "SKU Barcode", "입고예정일", "발주일", "발주수량", "확정수량", "입고수량"')
        .limit(10000),
      // coupang_orders
      supabase.from('coupang_orders')
        .select('order_date, barcode, order_qty, confirmed_qty, received_qty, center')
        .order('order_date', { ascending: false })
        .limit(10000),
    ])

    if (dailySalesRes.error) console.warn('[storage] daily_sales error:', dailySalesRes.error.message)
    if (productsRes.error)   console.warn('[storage] products error:', productsRes.error.message)

    const productsData = (productsRes.data || []) as Record<string, unknown>[]

    // barcode → product 정보 맵
    const barcodeMap = new Map<string, { name: string; option: string; cost: number }>()
    productsData.forEach(r => {
      const barcode = String(r['barcode'] || '')
      if (barcode) {
        barcodeMap.set(barcode, {
          name:   String(r['name'] || barcode),
          option: String(r['option_value'] || ''),
          cost:   Number(r['cost'] || 0),
        })
      }
    })

    // daily_sales → SalesRow (barcode로 상품명 + 원가 기반 매출 계산)
    const salesData: SalesRow[] = (dailySalesRes.data || []).map(r => {
      const info    = barcodeMap.get(r.barcode) || { name: r.barcode, option: '', cost: 0 }
      const qty     = Number(r.quantity || 0)
      // revenue가 있으면 사용, 없으면 cost * qty (원가 기준)
      const revenue = Number(r.revenue || 0) || (info.cost * qty)
      return {
        date:        r.date,
        productName: info.name,
        option:      info.option,
        qty,
        revenue,
        isReturn:    false,
      }
    })

    // masterData는 products 테이블 기반
    const masterData = productsData.map(r => ({
      ...r,
      상품명: r['name'],
      옵션:   r['option_value'],
      바코드: r['barcode'],
      재고:   r['current_stock'],
    }))

    const supplyData = (supplyRes.data  || []) as Record<string, unknown>[]
    const ordersData = (ordersRes.data  || []) as Record<string, unknown>[]
    const hasData    = salesData.length > 0 || masterData.length > 0

    if (hasData) {
      console.log('[CA] ✅ loaded from Supabase:', {
        sales:  salesData.length,
        master: masterData.length,
        supply: supplyData.length,
        orders: ordersData.length,
      })
    }

    return { salesData, masterData, ordersData, supplyData, hasData, dateRangePreset: 'total' }
  } catch (e) {
    console.warn('[storage] loadData error:', e)
    return null
  }
}

// 파일 업로드 시 Supabase upsert
export async function persistData(data: PersistedData): Promise<void> {
  if (typeof window === 'undefined') return

  const tasks: Promise<unknown>[] = []

  // product_master upsert (이지어드민 파일)
  if (data.masterData.length > 0) {
    const rows = data.masterData.map(r => ({
      상품명:     String(r['상품명'] || r['name'] || ''),
      옵션:       String(r['옵션']   || r['option_value'] || ''),
      바코드:     String(r['바코드'] || r['barcode'] || ''),
      매장총재고: String(r['재고']   || r['current_stock'] || '0'),
      원가:       Number(r['원가']   || r['cost'] || 0),
      판매가:     Number(r['판매가'] || 0),
      가용재고:   String(r['가용재고'] || '0'),
    })).filter(r => r['상품명'])
    for (let i = 0; i < rows.length; i += 500) {
      tasks.push(
        supabase.from('product_master')
          .upsert(rows.slice(i, i + 500), { onConflict: '상품명,옵션' })
          .then(({ error }) => { if (error) console.warn('[storage] master upsert:', error.message) })
      )
    }
  }

  // supply_status upsert (공급중수량 파일)
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
    for (let i = 0; i < rows.length; i += 500) {
      tasks.push(
        supabase.from('supply_status')
          .upsert(rows.slice(i, i + 500), { onConflict: '발주번호,"SKU Barcode"' })
          .then(({ error }) => { if (error) console.warn('[storage] supply upsert:', error.message) })
      )
    }
  }

  // coupang_orders insert (발주서 파일)
  if (data.ordersData.length > 0) {
    const rows = data.ordersData.map(r => ({
      order_date:    String(r['발주일'] || r['order_date'] || '').slice(0, 10),
      barcode:       String(r['바코드'] || r['barcode'] || ''),
      order_qty:     Number(r['발주수량'] || r['order_qty'] || 0),
      confirmed_qty: Number(r['확정수량'] || r['confirmed_qty'] || 0),
      received_qty:  Number(r['입고수량'] || r['received_qty'] || 0),
      center:        String(r['물류센터'] || r['center'] || ''),
    })).filter(r => r.barcode)
    for (let i = 0; i < rows.length; i += 500) {
      tasks.push(
        supabase.from('coupang_orders')
          .insert(rows.slice(i, i + 500))
          .then(({ error }) => { if (error) console.warn('[storage] orders insert:', error.message) })
      )
    }
  }

  await Promise.all(tasks)
  console.log('[CA] ✅ saved to Supabase:', {
    master: data.masterData.length,
    supply: data.supplyData.length,
    orders: data.ordersData.length,
  })
}

export async function clearData(): Promise<void> {
  console.log('[CA] clearData — Supabase 데이터는 유지됩니다')
}

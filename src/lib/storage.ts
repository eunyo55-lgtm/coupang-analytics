import { supabase } from '@/lib/supabase'
import type { SalesRow, Product } from '@/types'

export interface PersistedData {
  masterData:   Record<string, unknown>[]
  salesData:    SalesRow[]
  salesData24:  SalesRow[]   // 2024년 (YoY 비교용)
  salesData25:  SalesRow[]   // 2025년 (YoY 비교용)
  ordersData:   Record<string, unknown>[]
  supplyData:   Record<string, unknown>[]
  products:     Product[]
  dateRangePreset?: string
  hasData: boolean
}

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    // 날짜 범위 설정
    const today = new Date()
    const yearStart26 = '2026-01-01'
    const yearStart25 = '2025-01-01'
    const yearEnd25   = '2025-12-31'
    const yearStart24 = '2024-01-01'
    const yearEnd24   = '2024-12-31'

    const [
      sales26Res, sales25Res, sales24Res,
      productsRes, supplyRes, ordersRes
    ] = await Promise.all([
      // 2026년 판매 (올해)
      supabase.from('daily_sales')
        .select('date, barcode, quantity, fc_quantity, vf_quantity, stock, fc_stock, vf_stock')
        .gte('date', yearStart26)
        .lte('date', today.toISOString().slice(0, 10))
        .gt('quantity', 0)
        .order('date', { ascending: true })
        .range(0, 199999),
      // 2025년 판매 (전년)
      supabase.from('daily_sales')
        .select('date, barcode, quantity, fc_quantity, vf_quantity')
        .gte('date', yearStart25)
        .lte('date', yearEnd25)
        .gt('quantity', 0)
        .order('date', { ascending: true })
        .range(0, 199999),
      // 2024년 판매 (전전년)
      supabase.from('daily_sales')
        .select('date, barcode, quantity, fc_quantity, vf_quantity')
        .gte('date', yearStart24)
        .lte('date', yearEnd24)
        .gt('quantity', 0)
        .order('date', { ascending: true })
        .range(0, 199999),
      // products (바코드-상품명-원가-재고)
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

    // products 맵 생성
    const productsArr = (productsRes.data || [])
    const barcodeMap  = new Map<string, { name: string; option: string; cost: number; image: string }>()
    productsArr.forEach((r: Record<string,unknown>) => {
      const bc = String(r['barcode'] || '')
      if (bc) barcodeMap.set(bc, {
        name:   String(r['name']         || bc),
        option: String(r['option_value'] || ''),
        cost:   Number(r['cost']         || 0),
        image:  String(r['image_url']    || ''),
      })
    })

    // daily_sales → SalesRow 변환 함수
    const toSalesRows = (rows: Record<string,unknown>[]): SalesRow[] =>
      rows.map((r: Record<string,unknown>) => {
        const info     = barcodeMap.get(String(r['barcode'])) || { name: String(r['barcode']), option: '', cost: 0, image: '' }
        const outQty   = Number(r['fc_quantity'] || 0) + Number(r['vf_quantity'] || 0)
        const qty      = outQty || Number(r['quantity'] || 0)
        const revenue  = info.cost * qty  // 매출 = 원가 × 출고수량
        return {
          date:        String(r['date']),
          productName: info.name,
          option:      info.option,
          qty,
          revenue,
          isReturn:    false,
        }
      })

    const salesData   = toSalesRows((sales26Res.data || []) as Record<string,unknown>[])
    const salesData25 = toSalesRows((sales25Res.data || []) as Record<string,unknown>[])
    const salesData24 = toSalesRows((sales24Res.data || []) as Record<string,unknown>[])

    // products 타입 변환
    const products: Product[] = productsArr.map((r: Record<string,unknown>) => ({
      barcode:      String(r['barcode']      || ''),
      name:         String(r['name']         || ''),
      optionValue:  String(r['option_value'] || ''),
      cost:         Number(r['cost']         || 0),
      currentStock: Number(r['current_stock']|| 0),
      fcStock:      Number(r['fc_stock']     || 0),
      vfStock:      Number(r['vf_stock']     || 0),
      hqStock:      Number(r['hq_stock']     || 0),
      safetyStock:  Number(r['safety_stock'] || 0),
      incomingStock:Number(r['incoming_stock']|| 0),
      season:       String(r['season']       || ''),
      imageUrl:     String(r['image_url']    || ''),
    }))

    const supplyData = (supplyRes.data  || []) as Record<string,unknown>[]
    const ordersData = (ordersRes.data  || []) as Record<string,unknown>[]
    // masterData는 products 기반
    const masterData = productsArr.map((r: Record<string,unknown>) => ({
      ...r,
      상품명: r['name'], 옵션: r['option_value'],
      바코드: r['barcode'], 재고: r['current_stock'],
    })) as Record<string,unknown>[]

    const hasData = salesData.length > 0 || products.length > 0

    if (hasData) console.log('[CA] ✅ loaded from Supabase:', {
      '26': salesData.length, '25': salesData25.length, '24': salesData24.length,
      products: products.length, supply: supplyData.length,
    })

    return {
      salesData, salesData24, salesData25,
      masterData, products, ordersData, supplyData,
      hasData, dateRangePreset: 'total'
    }
  } catch (e) {
    console.warn('[storage] loadData error:', e)
    return null
  }
}

export async function persistData(data: PersistedData): Promise<void> {
  if (typeof window === 'undefined') return
  const tasks: Promise<unknown>[] = []

  if (data.masterData.length > 0) {
    const rows = data.masterData.map(r => ({
      상품명:     String(r['상품명'] || ''),
      옵션:       String(r['옵션']   || ''),
      바코드:     String(r['바코드'] || ''),
      매장총재고: String(r['재고']   || '0'),
      원가:       Number(r['원가']   || 0),
      판매가:     Number(r['판매가'] || 0),
      가용재고:   String(r['가용재고'] || '0'),
    })).filter(r => r['상품명'])
    for (let i = 0; i < rows.length; i += 500)
      tasks.push(supabase.from('product_master').upsert(rows.slice(i, i+500), { onConflict: '상품명,옵션' })
        .then(({ error }) => { if (error) console.warn('[storage] master:', error.message) }))
  }

  if (data.supplyData.length > 0) {
    const rows = data.supplyData.map(r => ({
      '발주번호':    Number(r['발주번호'] || 0),
      'SKU ID':      Number(r['SKU ID'] || 0),
      'SKU 이름':    String(r['SKU 이름'] || ''),
      'SKU Barcode': String(r['SKU Barcode'] || ''),
      '물류센터':    String(r['물류센터'] || ''),
      '입고예정일':  String(r['입고예정일'] || ''),
      '발주일':      String(r['발주일'] || ''),
      '발주수량':    Number(r['발주수량'] || 0),
      '확정수량':    Number(r['확정수량'] || 0),
      '입고수량':    String(r['입고수량'] || '0'),
    }))
    for (let i = 0; i < rows.length; i += 500)
      tasks.push(supabase.from('supply_status').upsert(rows.slice(i, i+500), { onConflict: '발주번호,"SKU Barcode"' })
        .then(({ error }) => { if (error) console.warn('[storage] supply:', error.message) }))
  }

  await Promise.all(tasks)
  console.log('[CA] ✅ saved to Supabase')
}

export async function clearData(): Promise<void> {
  console.log('[CA] clearData — Supabase 데이터는 유지됩니다')
}

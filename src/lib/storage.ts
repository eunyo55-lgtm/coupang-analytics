import { supabase } from '@/lib/supabase'
import type { SalesRow, Product } from '@/types'

export interface PersistedData {
  masterData:   Record<string, unknown>[]
  salesData:    SalesRow[]
  salesData24:  SalesRow[]
  salesData25:  SalesRow[]
  ordersData:   Record<string, unknown>[]
  supplyData:   Record<string, unknown>[]
  products:     Product[]
  dateRangePreset?: string
  hasData: boolean
}

// 페이지네이션으로 전체 데이터 가져오기 (1000행 제한 우회)
async function fetchAll(
  table: string,
  selectCols: string,
  filters?: (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  let from = 0

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(table).select(selectCols).range(from, from + PAGE - 1)
    if (filters) q = filters(q)
    const { data, error } = await q
    if (error) { console.warn(`[storage] ${table} fetch error:`, error.message); break }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break  // 마지막 페이지
    from += PAGE
    if (all.length > 500000) break  // 안전장치
  }
  return all
}

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    const today = new Date()
    const y26s = '2026-01-01'
    const y25s = '2025-01-01', y25e = '2025-12-31'
    const y24s = '2024-01-01', y24e = '2024-12-31'
    const todayStr = today.toISOString().slice(0, 10)

    // 모든 데이터를 병렬로 로드
    const [rows26, rows25, rows24, productsArr, supplyArr, ordersArr] = await Promise.all([
      fetchAll('daily_sales', 'date,barcode,quantity,fc_quantity,vf_quantity,stock,fc_stock,vf_stock',
        q => q.gte('date', y26s).lte('date', todayStr).gt('quantity', 0).order('date', { ascending: true })),
      fetchAll('daily_sales', 'date,barcode,quantity,fc_quantity,vf_quantity',
        q => q.gte('date', y25s).lte('date', y25e).gt('quantity', 0).order('date', { ascending: true })),
      fetchAll('daily_sales', 'date,barcode,quantity,fc_quantity,vf_quantity',
        q => q.gte('date', y24s).lte('date', y24e).gt('quantity', 0).order('date', { ascending: true })),
      fetchAll('products', 'barcode,name,option_value,cost,current_stock,safety_stock,season,hq_stock,fc_stock,vf_stock,incoming_stock,image_url',
        q => q.not('barcode', 'is', null)),
      fetchAll('supply_status', '"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"',
        q => q),
      fetchAll('coupang_orders', 'order_date,barcode,order_qty,confirmed_qty,received_qty,center',
        q => q.order('order_date', { ascending: false })),
    ])

    // barcode → 상품정보 맵
    const barcodeMap = new Map<string, { name: string; option: string; cost: number; image: string }>()
    productsArr.forEach(r => {
      const bc = String(r['barcode'] || '')
      if (bc) barcodeMap.set(bc, {
        name:   String(r['name']         || bc),
        option: String(r['option_value'] || ''),
        cost:   Number(r['cost']         || 0),
        image:  String(r['image_url']    || ''),
      })
    })

    // daily_sales → SalesRow
    const toRows = (raw: Record<string, unknown>[]): SalesRow[] =>
      raw.map(r => {
        const info   = barcodeMap.get(String(r['barcode'])) || { name: String(r['barcode']), option: '', cost: 0, image: '' }
        const outQty = Number(r['fc_quantity'] || 0) + Number(r['vf_quantity'] || 0)
        const qty    = outQty || Number(r['quantity'] || 0)
        return {
          date:        String(r['date']),
          productName: info.name,
          option:      info.option,
          qty,
          revenue:     info.cost * qty,
          isReturn:    false,
        }
      })

    const salesData   = toRows(rows26)
    const salesData25 = toRows(rows25)
    const salesData24 = toRows(rows24)

    const products: Product[] = productsArr.map(r => ({
      barcode:       String(r['barcode']       || ''),
      name:          String(r['name']          || ''),
      optionValue:   String(r['option_value']  || ''),
      cost:          Number(r['cost']          || 0),
      currentStock:  Number(r['current_stock'] || 0),
      fcStock:       Number(r['fc_stock']      || 0),
      vfStock:       Number(r['vf_stock']      || 0),
      hqStock:       Number(r['hq_stock']      || 0),
      safetyStock:   Number(r['safety_stock']  || 0),
      incomingStock: Number(r['incoming_stock']|| 0),
      season:        String(r['season']        || ''),
      imageUrl:      String(r['image_url']     || ''),
    }))

    const masterData = productsArr.map(r => ({
      ...r, 상품명: r['name'], 옵션: r['option_value'],
      바코드: r['barcode'], 재고: r['current_stock'],
    }))

    const hasData = salesData.length > 0 || products.length > 0

    console.log('[CA] ✅ loaded from Supabase:', {
      '26': salesData.length, '25': salesData25.length, '24': salesData24.length,
      products: products.length, supply: supplyArr.length,
    })

    return {
      salesData, salesData24, salesData25,
      masterData: masterData as Record<string,unknown>[],
      products, ordersData: ordersArr, supplyData: supplyArr,
      hasData, dateRangePreset: 'yesterday',
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
      상품명: String(r['상품명'] || ''), 옵션: String(r['옵션'] || ''),
      바코드: String(r['바코드'] || ''), 매장총재고: String(r['재고'] || '0'),
      원가: Number(r['원가'] || 0), 판매가: Number(r['판매가'] || 0),
      가용재고: String(r['가용재고'] || '0'),
    })).filter(r => r['상품명'])
    for (let i = 0; i < rows.length; i += 500)
      tasks.push(supabase.from('product_master').upsert(rows.slice(i,i+500), { onConflict: '상품명,옵션' })
        .then(({error}) => { if(error) console.warn('[storage] master:', error.message) }))
  }
  if (data.supplyData.length > 0) {
    const rows = data.supplyData.map(r => ({
      '발주번호': Number(r['발주번호']||0), 'SKU ID': Number(r['SKU ID']||0),
      'SKU 이름': String(r['SKU 이름']||''), 'SKU Barcode': String(r['SKU Barcode']||''),
      '물류센터': String(r['물류센터']||''), '입고예정일': String(r['입고예정일']||''),
      '발주일': String(r['발주일']||''), '발주수량': Number(r['발주수량']||0),
      '확정수량': Number(r['확정수량']||0), '입고수량': String(r['입고수량']||'0'),
    }))
    for (let i = 0; i < rows.length; i += 500)
      tasks.push(supabase.from('supply_status').upsert(rows.slice(i,i+500), { onConflict: '발주번호,"SKU Barcode"' })
        .then(({error}) => { if(error) console.warn('[storage] supply:', error.message) }))
  }
  await Promise.all(tasks)
  console.log('[CA] ✅ saved to Supabase')
}

export async function clearData(): Promise<void> {
  console.log('[CA] clearData — Supabase 데이터는 유지됩니다')
}

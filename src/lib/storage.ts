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

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    const today = new Date().toISOString().slice(0, 10)

    // ── 1. products 테이블 (1000행 이하라 페이지네이션 불필요)
    const { data: productsRaw } = await supabase
      .from('products')
      .select('barcode,name,option_value,cost,current_stock,safety_stock,season,hq_stock,fc_stock,vf_stock,incoming_stock,image_url')
      .not('barcode', 'is', null)
      .limit(10000)

    // barcode → 상품정보 맵
    const barcodeMap = new Map<string, { name: string; option: string; cost: number; image: string }>()
    ;(productsRaw || []).forEach((r: Record<string,unknown>) => {
      const bc = String(r['barcode'] || '')
      if (bc) barcodeMap.set(bc, {
        name:   String(r['name']         || bc),
        option: String(r['option_value'] || ''),
        cost:   Number(r['cost']         || 0),
        image:  String(r['image_url']    || ''),
      })
    })

    // ── 2. RPC로 3개년 일별 집계 + 공급/발주 병렬 로드
    const [res26, res25, res24, supplyRes, ordersRes] = await Promise.all([
      // RPC: 2026년 일별 집계 (날짜별 총 출고수량)
      supabase.rpc('get_daily_qty_by_year', { target_year: 2026 }),
      // RPC: 2025년 일별 집계
      supabase.rpc('get_daily_qty_by_year', { target_year: 2025 }),
      // RPC: 2024년 일별 집계
      supabase.rpc('get_daily_qty_by_year', { target_year: 2024 }),
      // supply_status
      supabase.from('supply_status')
        .select('"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"')
        .limit(5000),
      // coupang_orders
      supabase.from('coupang_orders')
        .select('order_date,barcode,order_qty,confirmed_qty,received_qty,center')
        .order('order_date', { ascending: false })
        .limit(5000),
    ])

    if (res26.error) console.warn('[storage] 26년:', res26.error.message)
    if (res25.error) console.warn('[storage] 25년:', res25.error.message)
    if (res24.error) console.warn('[storage] 24년:', res24.error.message)

    // RPC 결과 → SalesRow 변환
    // RPC는 날짜별 합산이므로 productName = 'aggregated' 으로 처리
    // TOP10/KPI용으로는 별도 RPC 호출 (대시보드에서 on-demand)
    const rpcToRows = (rows: Record<string,unknown>[], year: number): SalesRow[] =>
      (rows || []).map(r => ({
        date:        String(r['sale_date'] || ''),
        productName: '__daily_total__',  // 집계 데이터 마커
        option:      '',
        qty:         Number(r['total_qty'] || 0),
        revenue:     0,  // 날짜별 매출은 별도 계산
        isReturn:    false,
      }))

    // 실제 판매 데이터도 필요 (상품별 TOP10용) — 최근 90일만 원시 데이터 로드
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const dateFrom = ninetyDaysAgo.toISOString().slice(0, 10)

    const { data: recentSales } = await supabase
      .from('daily_sales')
      .select('date,barcode,quantity,fc_quantity,vf_quantity,stock,fc_stock,vf_stock')
      .gte('date', dateFrom)
      .lte('date', today)
      .gt('quantity', 0)
      .order('date', { ascending: true })

    const salesData: SalesRow[] = (recentSales || []).map((r: Record<string,unknown>) => {
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

    // 3개년 일별 집계 데이터 (차트용)
    const salesData24 = rpcToRows(res24.data || [], 2024)
    const salesData25 = rpcToRows(res25.data || [], 2025)
    // 2026 차트용은 RPC 데이터와 원시 데이터 병합
    const daily26Map = new Map<string, number>()
    ;(res26.data || []).forEach((r: Record<string,unknown>) => {
      daily26Map.set(String(r['sale_date']), Number(r['total_qty']))
    })
    // salesData에서도 일별 합산으로 보완
    salesData.forEach(r => {
      const cur = daily26Map.get(r.date) || 0
      if (!cur) daily26Map.set(r.date, r.qty)
    })

    const products: Product[] = (productsRaw || []).map((r: Record<string,unknown>) => ({
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

    const masterData = (productsRaw || []).map((r: Record<string,unknown>) => ({
      ...r, 상품명: r['name'], 옵션: r['option_value'],
      바코드: r['barcode'], 재고: r['current_stock'],
    })) as Record<string,unknown>[]

    const hasData = salesData.length > 0 || products.length > 0

    console.log('[CA] ✅ Supabase 로드 완료:', {
      sales90d: salesData.length,
      daily26: res26.data?.length,
      daily25: salesData25.length,
      daily24: salesData24.length,
      products: products.length,
    })

    // salesData24/25는 차트용 집계 — DashboardPage에서 '__daily_total__' 체크 후 사용
    return {
      salesData,
      salesData24,
      salesData25,
      masterData,
      products,
      ordersData:  (ordersRes.data  || []) as Record<string,unknown>[],
      supplyData:  (supplyRes.data  || []) as Record<string,unknown>[],
      hasData,
      dateRangePreset: 'yesterday',
      // 차트용 일별 집계 원본도 함께 전달
      _daily26: Array.from(daily26Map.entries()).map(([date, qty]) => ({ date, qty })),
      _daily25: (res25.data || []).map((r: Record<string,unknown>) => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) })),
      _daily24: (res24.data || []).map((r: Record<string,unknown>) => ({ date: String(r['sale_date']), qty: Number(r['total_qty']) })),
    } as PersistedData & { _daily26: {date:string,qty:number}[], _daily25: {date:string,qty:number}[], _daily24: {date:string,qty:number}[] }
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
      상품명: String(r['상품명']||''), 옵션: String(r['옵션']||''),
      바코드: String(r['바코드']||''), 매장총재고: String(r['재고']||'0'),
      원가: Number(r['원가']||0), 판매가: Number(r['판매가']||0),
      가용재고: String(r['가용재고']||'0'),
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
  console.log('[CA] ✅ Supabase 저장 완료')
}

export async function clearData(): Promise<void> {
  console.log('[CA] clearData — Supabase 데이터는 유지됩니다')
}

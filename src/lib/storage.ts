import { supabase } from '@/lib/supabase'
import type { Product } from '@/types'

export interface PersistedData {
  masterData:   Record<string, unknown>[]
  salesData:    never[]   // 더 이상 원시 salesData 사용 안 함 — RPC로 대체
  salesData24:  never[]
  salesData25:  never[]
  ordersData:   Record<string, unknown>[]
  supplyData:   Record<string, unknown>[]
  products:     Product[]
  dateRangePreset?: string
  hasData: boolean
  // RPC 집계 결과
  stockSummary: { total_fc: number; total_vf: number; total_hq: number; grand_total: number; stock_value: number }
  daily26: { date: string; qty: number }[]
  daily25: { date: string; qty: number }[]
  daily24: { date: string; qty: number }[]
  latestSaleDate: string
}

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    const [stockRes, daily26Res, daily25Res, daily24Res, supplyRes, ordersRes] = await Promise.all([
      supabase.rpc('get_stock_summary'),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2026 }),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2025 }),
      supabase.rpc('get_daily_qty_by_year', { target_year: 2024 }),
      supabase.from('supply_status')
        .select('"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"')
        .limit(5000),
      supabase.from('coupang_orders')
        .select('order_date,barcode,order_qty,confirmed_qty,received_qty,center')
        .order('order_date', { ascending: false })
        .limit(5000),
    ])

    if (stockRes.error) console.warn('[storage] stock:', stockRes.error.message)
    if (daily26Res.error) console.warn('[storage] daily26:', daily26Res.error.message)
    if (daily25Res.error) console.warn('[storage] daily25:', daily25Res.error.message)
    if (daily24Res.error) console.warn('[storage] daily24:', daily24Res.error.message)

    const stockSummary = stockRes.data?.[0] ?? { total_fc: 0, total_vf: 0, total_hq: 0, grand_total: 0, stock_value: 0 }

    const daily26 = (daily26Res.data || []).map((r: Record<string,unknown>) => ({
      date: String(r['sale_date']), qty: Number(r['total_qty'])
    }))
    const daily25 = (daily25Res.data || []).map((r: Record<string,unknown>) => ({
      date: String(r['sale_date']), qty: Number(r['total_qty'])
    }))
    const daily24 = (daily24Res.data || []).map((r: Record<string,unknown>) => ({
      date: String(r['sale_date']), qty: Number(r['total_qty'])
    }))

    // 가장 최근 판매일 파악
    const latestSaleDate = daily26.length > 0 ? daily26[daily26.length - 1].date : ''

    const hasData = daily26.length > 0

    console.log('[CA] ✅ Supabase 로드 완료:', {
      stock: stockSummary.grand_total,
      daily26: daily26.length,
      daily25: daily25.length,
      daily24: daily24.length,
      latestSaleDate,
    })

    return {
      salesData:    [] as never[],
      salesData24:  [] as never[],
      salesData25:  [] as never[],
      masterData:   [],
      products:     [],
      ordersData:   (ordersRes.data || []) as Record<string,unknown>[],
      supplyData:   (supplyRes.data  || []) as Record<string,unknown>[],
      hasData,
      dateRangePreset: 'yesterday',
      stockSummary,
      daily26,
      daily25,
      daily24,
      latestSaleDate,
    }
  } catch (e) {
    console.warn('[storage] loadData error:', e)
    return null
  }
}

export async function persistData(_data: PersistedData): Promise<void> {
  console.log('[CA] persistData — 파일 업로드 기능 추후 추가 예정')
}

export async function clearData(): Promise<void> {
  console.log('[CA] clearData — Supabase 데이터는 유지됩니다')
}

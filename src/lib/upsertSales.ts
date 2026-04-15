// 쿠팡 허브 판매 데이터를 daily_sales 테이블에 upsert
import { supabase } from '@/lib/supabase'

export interface DailySalesRow {
  date: string
  barcode: string
  quantity: number
  stock: number
  cost: number
}

export async function upsertDailySales(rows: DailySalesRow[]): Promise<{ success: number; error: string | null }> {
  if (!rows.length) return { success: 0, error: null }

  // 배치 500행씩 upsert
  let successCount = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map(r => ({
      date:        r.date,
      barcode:     r.barcode,
      quantity:    r.quantity,
      fc_quantity: 0,
      vf_quantity: 0,
      stock:       r.stock,
      fc_stock:    0,
      vf_stock:    0,
      revenue:     0,
    }))

    const { error } = await supabase
      .from('daily_sales')
      .upsert(batch, { onConflict: 'date,barcode' })

    if (error) {
      console.warn('[upsert] daily_sales error:', error.message)
      return { success: successCount, error: error.message }
    }
    successCount += batch.length
  }

  // MV 갱신 (새 데이터 반영)
  await Promise.all([
    supabase.rpc('refresh_mv_daily_qty').catch(() => {}),
    supabase.rpc('refresh_mv_kpi_daily').catch(() => {}),
  ])

  console.log('[CA] ✅ daily_sales upsert 완료:', successCount, '행')
  return { success: successCount, error: null }
}

import { supabase } from '@/lib/supabase'

export interface DailySalesRow {
  date: string
  barcode: string
  quantity: number
  stock: number
  cost: number
  productName?: string
}

export async function upsertDailySales(rows: DailySalesRow[]): Promise<{ success: number; error: string | null }> {
  if (!rows.length) return { success: 0, error: null }

  let successCount = 0

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)

    // 1. daily_sales 저장 (기존)
    const dailyBatch = batch.map(r => ({
      date: r.date,
      barcode: r.barcode,
      quantity: r.quantity,
      fc_quantity: 0,
      vf_quantity: 0,
      stock: r.stock,
      fc_stock: 0,
      vf_stock: 0,
      revenue: 0,
    }))
    const { error: e1 } = await supabase
      .from('daily_sales')
      .upsert(dailyBatch, { onConflict: 'date,barcode' })
    if (e1) {
      console.warn('[upsert] daily_sales error:', e1.message)
      return { success: successCount, error: e1.message }
    }

    // 2. sales_data 저장 (대시보드 RPC가 보는 테이블)
    const salesBatch = batch.map(r => ({
      sale_date: r.date,
      product_name: r.productName || r.barcode,
      sku: r.barcode,
      quantity: r.quantity,
      amount: r.quantity * (r.cost || 0),
      coupang_stock: r.stock,
    }))
    const { error: e2 } = await supabase
      .from('sales_data')
      .upsert(salesBatch, { onConflict: 'sale_date,sku' })
    if (e2) {
      console.warn('[upsert] sales_data error:', e2.message)
      // sales_data 실패는 경고만 (daily_sales는 이미 성공)
    }

    successCount += batch.length
  }

  // Materialized View 갱신
  try {
    await supabase.rpc('refresh_analytics_mv')
  } catch (e) {
    console.warn('[upsert] MV refresh 실패 (무시):', e)
  }

  console.log('[CA] upsert 완료:', successCount, '행')
  return { success: successCount, error: null }
}

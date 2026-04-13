'use client'

import { useMemo } from 'react'
import { useApp } from '@/lib/store'
import { toYMD, filterByRange } from '@/lib/dateUtils'
import { detectColumn, toNumber } from '@/lib/fileParser'
import type { SalesByProduct, DailySales, InventoryItem } from '@/types'

export function useAnalytics() {
  const { state } = useApp()
  const { salesData, masterData, ordersData, supplyData, dateRange } = state

  // ── Sales filtered by date range ──
  const filteredSales = useMemo(() => {
    return filterByRange(salesData, dateRange).filter(r => !r.isReturn)
  }, [salesData, dateRange])

  // ── Aggregated by product (for date range) ──
  const salesByProduct = useMemo<SalesByProduct[]>(() => {
    const map = new Map<string, SalesByProduct>()
    filteredSales.forEach(row => {
      const key = `${row.productName}|${row.option}`
      const existing = map.get(key)
      if (existing) {
        existing.qty     += row.qty
        existing.revenue += row.revenue
      } else {
        map.set(key, { name: row.productName, option: row.option, qty: row.qty, revenue: row.revenue })
      }
    })
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
  }, [filteredSales])

  // ── Daily sales (all data, for chart) ──
  const dailySales = useMemo<DailySales[]>(() => {
    const map = new Map<string, DailySales>()
    filterByRange(salesData.filter(r => !r.isReturn), dateRange).forEach(row => {
      const existing = map.get(row.date)
      if (existing) {
        existing.revenue += row.revenue
        existing.qty     += row.qty
      } else {
        map.set(row.date, { date: row.date, revenue: row.revenue, qty: row.qty })
      }
    })
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1))
  }, [salesData, dateRange])

  // ── KPI totals ──
  const totals = useMemo(() => {
    const revenue   = filteredSales.reduce((s, r) => s + r.revenue, 0)
    const qty       = filteredSales.reduce((s, r) => s + r.qty, 0)
    const returns   = filterByRange(salesData, dateRange).filter(r => r.isReturn).length
    const skuCount  = salesByProduct.length
    const avgPrice  = qty > 0 ? Math.round(revenue / qty) : 0
    return { revenue, qty, returns, skuCount, avgPrice }
  }, [filteredSales, salesData, dateRange, salesByProduct])

  // ── Days in range (for daily average calculation) ──
  const daysInRange = useMemo(() => {
    const diff = Math.round(
      (dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1
    return Math.max(diff, 1)
  }, [dateRange])

  // ── Supply map ──
  const supplyMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!supplyData.length) return map
    const s0    = supplyData[0] as Record<string, unknown>
    const nameC = detectColumn(s0, ['상품명', 'item', 'productName'])
    const qtyC  = detectColumn(s0, ['수량', 'qty', '공급수량', '입고수량'])
    supplyData.forEach(row => {
      const r = row as Record<string, unknown>
      const n = nameC ? String(r[nameC] || '') : ''
      const q = toNumber(r[qtyC || ''])
      if (n) map.set(n, (map.get(n) || 0) + q)
    })
    return map
  }, [supplyData])

  // ── Inventory calculation ──
  const inventory = useMemo<InventoryItem[]>(() => {
    const safetyDays = 14
    const leadDays   = 7
    const src = masterData.length ? masterData : ordersData
    if (!src.length) return []

    const s0    = src[0] as Record<string, unknown>
    const nameC = detectColumn(s0, ['상품명', 'item', 'productName'])
    const optC  = detectColumn(s0, ['옵션', 'option', '옵션명'])
    const stC   = detectColumn(s0, ['재고', 'stock', '현재고', '수량', '재고수량'])

    // Daily sales rate per product
    const salesRate = new Map<string, number>()
    salesByProduct.forEach(p => {
      salesRate.set(`${p.name}|${p.option}`, p.qty / daysInRange)
    })

    const items: InventoryItem[] = []
    src.slice(0, 200).forEach(rawRow => {
      const row  = rawRow as Record<string, unknown>
      const name = nameC ? String(row[nameC] || '') : ''
      if (!name) return
      const option   = optC ? String(row[optC] || '') : ''
      const stock    = toNumber(row[stC || ''])
      const supplyQty = supplyMap.get(name) || 0
      const key      = `${name}|${option}`
      const dailySalesRate = salesRate.get(key) || salesRate.get(`${name}|`) || 0.1
      const daysLeft = dailySalesRate > 0
        ? Math.round((stock + supplyQty) / dailySalesRate)
        : 999
      const recommendOrder = Math.max(
        0,
        Math.ceil(dailySalesRate * (safetyDays + leadDays)) - stock - supplyQty
      )
      const status: InventoryItem['status'] =
        daysLeft < leadDays   ? 'danger' :
        daysLeft < safetyDays ? 'warn'   : 'ok'

      items.push({ name, option, stock, supplyQty, dailySales: dailySalesRate, daysLeft, recommendOrder, status })
    })

    return items.sort((a, b) => a.daysLeft - b.daysLeft)
  }, [masterData, ordersData, salesByProduct, supplyMap, daysInRange])

  return { filteredSales, salesByProduct, dailySales, totals, inventory, daysInRange }
}

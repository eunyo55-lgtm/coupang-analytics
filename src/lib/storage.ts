'use client'

import { supabase } from '@/lib/supabase'

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI'

export interface PersistedData {
  masterData:   Record<string, unknown>[]
  salesData:    {
    date:string; productName:string; option:string; barcode?:string;
    qty:number; revenue:number; isReturn:boolean;
    season?:string; category?:string; imageUrl?:string; cost?:number
  }[]
  salesData24:  never[]
  salesData25:  never[]
  ordersData:   Record<string, unknown>[]
  supplyData:   Record<string, unknown>[]
  products:     never[]
  dateRangePreset?: string
  hasData: boolean
  stockSummary: {
    total_stock: number
    stock_value: number            // 호환용 (= stock_value_master)
    stock_value_master?: number    // 상품마스터 원가 기준
    stock_value_coupang?: number   // 쿠팡 매입가 기준
  }
  daily26: { date: string; qty: number }[]
  daily25: { date: string; qty: number }[]
  daily24: { date: string; qty: number }[]
  latestSaleDate: string
}

// fetch로 RPC 호출 — 일반용
async function rpcFetch(fn: string, params: Record<string,unknown> = {}) {
  if (typeof window === 'undefined') return []
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!res.ok) { console.warn(`[storage] RPC ${fn} error:`, res.status); return [] }
    return await res.json()
  } catch(e) { console.warn(`[storage] RPC ${fn}:`, e); return [] }
}

// 테이블 직접 페이지네이션 (1000행 제한 우회)
async function fetchAllPages(path: string, extraHeaders: Record<string,string> = {}) {
  if (typeof window === 'undefined') return []
  const all: Record<string,unknown>[] = []
  let offset = 0
  const PAGE = 1000
  while (true) {
    const sep = path.includes('?') ? '&' : '?'
    const url = `${SUPA_URL}/rest/v1/${path}${sep}offset=${offset}&limit=${PAGE}`
    const res = await fetch(url, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, ...extraHeaders }
    })
    console.log('[fetchAllPages]', path.substring(0,30), 'offset:', offset, 'status:', res.status)
    if (!res.ok) { console.warn('[fetchAllPages] not ok:', res.status, await res.text().catch(()=>'')); break }
    const data = await res.json()
    console.log('[fetchAllPages] data type:', typeof data, 'isArray:', Array.isArray(data), 'length:', Array.isArray(data) ? data.length : 'N/A')
    if (!Array.isArray(data) || !data.length) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
    if (all.length > 300000) break
  }
  return all
}

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    const today = new Date().toISOString().slice(0, 10)
    const yearStart = `${new Date().getFullYear()}-01-01`  // 누적(1/1~전일) 계산용
    const ninetyAgo = new Date()
    ninetyAgo.setDate(ninetyAgo.getDate() - 90)
    const from90 = ninetyAgo.toISOString().slice(0, 10)
    // 누적은 올해 전체 데이터가 필요하므로 max(yearStart, from90)보다 이른 날짜로
    const fromLoad = yearStart < from90 ? yearStart : from90

    // 모든 데이터 병렬 로드
    const [stock, daily26, daily25, daily24, salesRaw, supplyRes, ordersRes] = await Promise.all([
      rpcFetch('get_stock_summary'),
      rpcFetch('get_daily_qty_by_year', { target_year: 2026 }),
      rpcFetch('get_daily_qty_by_year', { target_year: 2025 }),
      rpcFetch('get_daily_qty_by_year', { target_year: 2024 }),
      // daily_sales — 올해 1/1 ~ 오늘 (누적, 주간, 일별 모두 계산 가능하도록)
      fetchAllPages(
        `daily_sales?select=date,barcode,quantity&date=gte.${fromLoad}&date=lte.${today}&quantity=gt.0&order=date.asc`
      ),
      supabase.from('supply_status')
        .select('"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"')
        .limit(5000),
      supabase.from('coupang_orders')
        .select('order_date,barcode,order_qty,confirmed_qty,received_qty,center')
        .order('order_date', { ascending: false })
        .limit(5000),
    ])

    // products 페이지네이션으로 전체 로드 (barcode→name/season/image_url 매핑용)
    // season/image_url/category/hq_stock 는 존재하지 않을 수도 있음 → 실패 시 fallback
    let productsRaw: Record<string,unknown>[] = []
    try {
      productsRaw = await fetchAllPages('products?select=barcode,name,option_value,cost,season,image_url,category,hq_stock&barcode=not.is.null&name=not.is.null')
    } catch {
      try {
        productsRaw = await fetchAllPages('products?select=barcode,name,option_value,cost,season,image_url,category&barcode=not.is.null&name=not.is.null')
      } catch {
        // season/image_url/category 컬럼이 없는 경우 대비
        productsRaw = await fetchAllPages('products?select=barcode,name,option_value,cost&barcode=not.is.null&name=not.is.null')
      }
    }

    interface ProductInfo {
      name: string; option: string; cost: number;
      season: string; imageUrl: string; category: string; hqStock: number
    }
    const barcodeMap = new Map<string, ProductInfo>()
    productsRaw.forEach(r => {
      const bc = String(r['barcode'] || '')
      if (bc) barcodeMap.set(bc, {
        name:     String(r['name'] || bc),
        option:   String(r['option_value'] || ''),
        cost:     Number(r['cost'] || 0),
        season:   String(r['season'] || ''),
        imageUrl: String(r['image_url'] || ''),
        category: String(r['category'] || ''),
        hqStock:  Number(r['hq_stock'] || 0),
      })
    })

    // SalesRow 변환 — season/image/category도 함께 실어서 저장
    const salesData = (salesRaw as Record<string,unknown>[]).map(r => {
      const bc   = String(r['barcode'] || '')
      const info = barcodeMap.get(bc) || { name: bc, option: '', cost: 0, season: '', imageUrl: '', category: '' }
      const qty  = Number(r['quantity'] || 0)
      return {
        date:        String(r['date']),
        productName: info.name,
        option:      info.option,
        barcode:     bc,
        qty,
        revenue:     info.cost * qty,
        isReturn:    false,
        season:      info.season,
        imageUrl:    info.imageUrl,
        category:    info.category,
        cost:        info.cost,
      }
    })

    const stockSummary = (stock as Record<string,unknown>[])[0] ?? { total_stock: 0, stock_value: 0 }
    // sale_date 정규화: PostgREST가 DATE/TIMESTAMP에 따라 'YYYY-MM-DD' 또는
    // 'YYYY-MM-DDTHH:mm:ss+00:00'로 반환할 수 있음. 차트가 'YYYY-MM-DD' 키로
    // 매칭하므로 항상 첫 10자만 사용 — 25년/24년 라인이 0으로 보이던 원인.
    const ymd = (v: unknown) => String(v ?? '').slice(0, 10)
    const d26 = (daily26 as Record<string,unknown>[]).map(r => ({ date: ymd(r['sale_date']), qty: Number(r['total_qty']) }))
    const d25 = (daily25 as Record<string,unknown>[]).map(r => ({ date: ymd(r['sale_date']), qty: Number(r['total_qty']) }))
    const d24 = (daily24 as Record<string,unknown>[]).map(r => ({ date: ymd(r['sale_date']), qty: Number(r['total_qty']) }))
    const latestSaleDate = d26.length > 0 ? d26[d26.length - 1].date : ''

    // masterData: 재고현황용 상품 목록
    const seen = new Set<string>()
    const masterData = salesData.reduce((acc: Record<string,unknown>[], r) => {
      if (!seen.has(r.productName)) {
        seen.add(r.productName)
        acc.push({ 상품명: r.productName, 옵션: r.option, 바코드: r.barcode || '' })
      }
      return acc
    }, [])

    console.log('[CA] ✅ Supabase 로드 완료:', {
      salesYTD: salesData.length,
      daily26: d26.length,
      daily25: d25.length,
      daily24: d24.length,
      stock: (stockSummary as Record<string,unknown>).total_stock,
      latestSaleDate,
      products: productsRaw.length,
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
      stockSummary: stockSummary as {
        total_stock: number
        stock_value: number
        stock_value_master?: number
        stock_value_coupang?: number
      },
      daily26: d26, daily25: d25, daily24: d24,
      latestSaleDate,
    }
  } catch (e) {
    console.warn('[storage] loadData error:', e)
    return null
  }
}

export async function persistData(_data: PersistedData): Promise<void> {}
export async function clearData(): Promise<void> { console.log('[CA] clearData') }

'use client'

import { supabase } from '@/lib/supabase'
import { readSwrCache, writeSwrCache } from '@/lib/swrCache'
import { vatExcluded } from '@/lib/vatUtils'

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI'

export interface PersistedData {
  masterData:   Record<string, unknown>[]
  salesData:    {
    date:string; productName:string; option:string; barcode?:string;
    qty:number; revenue:number; isReturn:boolean;
    season?:string; category?:string; imageUrl?:string;
    cost?:number;       // 원가 — 재고액
    salePrice?:number;  // 판매가/시중가 — 판매액
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

// fetch로 RPC 호출 — 5xx 일시 오류는 자동 재시도.
// 백오프: 1.2s → 3.6s. statement_timeout(8s)으로 잘린 쿼리가 MV가 따뜻해진 후
// 통과할 수 있도록 충분한 간격을 둠. per-request timeout 30s.
async function rpcFetch(fn: string, params: Record<string,unknown> = {}) {
  if (typeof window === 'undefined') return []
  const RETRIES = 2
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 30000)
    try {
      const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      })
      if (res.ok) {
        if (attempt > 0) console.log(`[storage] RPC ${fn} recovered on attempt ${attempt + 1}`)
        return await res.json()
      }
      // 5xx (서버 일시 오류, statement timeout 포함)면 재시도. 4xx면 바로 빈 배열.
      if (res.status >= 500 && attempt < RETRIES) {
        console.warn(`[storage] RPC ${fn} ${res.status} — 재시도 ${attempt + 1}/${RETRIES + 1}`)
      } else {
        console.warn(`[storage] RPC ${fn} error:`, res.status)
        return []
      }
    } catch(e) {
      if (attempt < RETRIES) {
        console.warn(`[storage] RPC ${fn} 네트워크/abort — 재시도 ${attempt + 1}/${RETRIES + 1}`)
      } else {
        console.warn(`[storage] RPC ${fn}:`, e)
        return []
      }
    } finally {
      clearTimeout(tid)
    }
    await new Promise(r => setTimeout(r, 1200 * Math.pow(3, attempt)))
  }
  return []
}

// 테이블 직접 페이지네이션 — 병렬 fetch.
// PostgREST max-rows = 1000. 페이지를 동시에 N개 발사해 round-trip 지연(평균 250ms/페이지)을
// 압축. 100k+ row 다운로드를 30초 → 2~3초로 단축.
async function fetchAllPages(path: string, extraHeaders: Record<string,string> = {}, concurrency = 16) {
  if (typeof window === 'undefined') return []
  const all: Record<string,unknown>[] = []
  const PAGE = 1000
  const sep = path.includes('?') ? '&' : '?'
  const makeUrl = (off: number) => `${SUPA_URL}/rest/v1/${path}${sep}offset=${off}&limit=${PAGE}`
  const H = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, ...extraHeaders }

  let nextOffset = 0
  let done = false
  while (!done) {
    const batchOffsets = Array.from({ length: concurrency }, (_, i) => nextOffset + i * PAGE)
    const results = await Promise.all(batchOffsets.map(async off => {
      try {
        const res = await fetch(makeUrl(off), { headers: H })
        if (!res.ok) { console.warn('[fetchAllPages] not ok:', res.status, off); return [] }
        const data = await res.json()
        return Array.isArray(data) ? data : []
      } catch (e) { console.warn('[fetchAllPages] err:', e, off); return [] }
    }))
    // 결과를 offset 순서대로 누적 + 마지막 페이지 탐지
    for (const arr of results) {
      all.push(...arr)
      if (arr.length < PAGE) done = true
    }
    nextOffset += concurrency * PAGE
    if (all.length > 500000) break  // safety
  }
  return all
}

// ── localStorage 캐시 (Essential 데이터만, 5분 TTL) ──
// 같은 세션 내 빠른 재방문 시 즉시 화면 표시 (백그라운드에서 fresh 로드)
// v3: VAT 별도 적용으로 캐시 무효화
const CACHE_KEY = 'ca_essential_v3'
const CACHE_TTL_MS = 5 * 60 * 1000  // 5분

interface EssentialCache {
  ts: number
  data: EssentialData
}

function readEssentialCache(): EssentialData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as EssentialCache
    if (Date.now() - c.ts > CACHE_TTL_MS) return null
    return c.data
  } catch { return null }
}

function writeEssentialCache(data: EssentialData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // quota / serialize 실패 무시
  }
}

// ── Phase 1: Essential — 대시보드 표시에 필요한 가벼운 데이터 (~2초)
export interface EssentialData {
  stockSummary: PersistedData['stockSummary']
  daily26: { date: string; qty: number }[]
  daily25: { date: string; qty: number }[]
  daily24: { date: string; qty: number }[]
  latestSaleDate: string
  ordersData: Record<string, unknown>[]
  supplyData: Record<string, unknown>[]
}

export async function loadEssential(): Promise<EssentialData | null> {
  if (typeof window === 'undefined') return null
  try {
    const [stock, daily26, daily25, daily24, supplyRes, ordersRes] = await Promise.all([
      rpcFetch('get_stock_summary'),
      rpcFetch('get_daily_qty_by_year', { target_year: 2026 }),
      rpcFetch('get_daily_qty_by_year', { target_year: 2025 }),
      rpcFetch('get_daily_qty_by_year', { target_year: 2024 }),
      supabase.from('supply_status')
        .select('"발주번호","SKU 이름","SKU Barcode","입고예정일","발주일","발주수량","확정수량","입고수량"')
        .limit(5000),
      supabase.from('coupang_orders')
        .select('order_date,barcode,order_qty,confirmed_qty,received_qty,center')
        .order('order_date', { ascending: false })
        .limit(5000),
    ])

    const stockSummary = (stock as Record<string,unknown>[])[0] ?? { total_stock: 0, stock_value: 0 }
    const ymd = (v: unknown) => String(v ?? '').slice(0, 10)
    const d26 = (daily26 as Record<string,unknown>[]).map(r => ({ date: ymd(r['sale_date']), qty: Number(r['total_qty']) }))
    const d25 = (daily25 as Record<string,unknown>[]).map(r => ({ date: ymd(r['sale_date']), qty: Number(r['total_qty']) }))
    const d24 = (daily24 as Record<string,unknown>[]).map(r => ({ date: ymd(r['sale_date']), qty: Number(r['total_qty']) }))
    const latestSaleDate = d26.length > 0 ? d26[d26.length - 1].date : ''

    const result: EssentialData = {
      stockSummary: stockSummary as EssentialData['stockSummary'],
      daily26: d26, daily25: d25, daily24: d24, latestSaleDate,
      ordersData: (ordersRes.data || []) as Record<string,unknown>[],
      supplyData: (supplyRes.data  || []) as Record<string,unknown>[],
    }
    console.log('[CA] ⚡ Essential 로드 완료:', { daily26: d26.length, daily25: d25.length, daily24: d24.length, latestSaleDate })
    return result
  } catch (e) {
    console.warn('[storage] loadEssential error:', e)
    return null
  }
}

export function readEssentialFromCache(): EssentialData | null {
  if (typeof window === 'undefined') return null
  return readEssentialCache()
}

export function cacheEssential(data: EssentialData) {
  writeEssentialCache(data)
}

// ── Phase 2: Historical — SalesPage/InventoryPage용 대용량 데이터 (백그라운드)
export interface HistoricalData {
  salesData: PersistedData['salesData']
  masterData: PersistedData['masterData']
}

// ── Historical 캐시
// v5: 증분 동기화 — 캐시에 lastSyncDate 저장, 이후엔 새 날짜만 fetch
const HISTORICAL_CACHE_KEY = 'swr_historical_v6'
const HISTORICAL_TTL_MS = 30 * 60 * 1000  // 30분: stale 표시용 (store.tsx 백그라운드 fetch 트리거)
const HISTORICAL_DAYS_BACK = 90           // 캐시에 유지할 최대 기간
const FULL_REFRESH_AFTER_DAYS = 7         // 마지막 동기화가 7일 이상 지났으면 풀 리로드

interface HistoricalCacheV5 extends HistoricalData {
  lastSyncDate: string  // 캐시에 들어있는 가장 마지막 날짜 (YYYY-MM-DD)
}

export function readHistoricalFromCache(): { data: HistoricalData; stale: boolean } | null {
  const r = readSwrCache<HistoricalCacheV5>(HISTORICAL_CACHE_KEY, HISTORICAL_TTL_MS)
  if (!r) return null
  return {
    data: { salesData: r.data.salesData, masterData: r.data.masterData },
    stale: r.stale,
  }
}

function readHistoricalRaw(): HistoricalCacheV5 | null {
  // TTL 무시하고 raw 데이터 — 증분 동기화에 사용
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(HISTORICAL_CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as { ts: number; data: HistoricalCacheV5 }
    return c.data || null
  } catch { return null }
}

export function cacheHistorical(_data: HistoricalData) {
  // No-op: loadHistorical()이 직접 캐시를 쓴다 (lastSyncDate 포함).
  // 호환성 위해 export는 유지.
}

function writeHistoricalCache(data: HistoricalCacheV5) {
  const approxBytes = data.salesData.length * 200 + data.masterData.length * 100
  if (approxBytes > 5 * 1024 * 1024) {
    console.log('[CA] historical too large for cache, skipping localStorage')
    return
  }
  writeSwrCache(HISTORICAL_CACHE_KEY, data)
}

function ymdShift(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + deltaDays)
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
}
function ymdDaysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(ay, am-1, ad) - Date.UTC(by, bm-1, bd)) / 86400_000)
}

interface ProductInfo {
  name: string; option: string;
  cost: number;        // 원가 — 재고액 계산용
  salePrice: number;   // 판매가/시중가 — 판매액 계산용
  season: string; imageUrl: string; category: string; hqStock: number
}

async function fetchProductsByBarcodes(barcodes: string[]): Promise<Record<string,unknown>[]> {
  if (barcodes.length === 0) return []
  const out: Record<string,unknown>[] = []
  const CHUNK = 200
  const chunks: string[][] = []
  for (let i = 0; i < barcodes.length; i += CHUNK) chunks.push(barcodes.slice(i, i + CHUNK))

  const fetchChunk = async (chunk: string[]) => {
    const inList = chunk.map(b => `"${b}"`).join(',')
    const tryFetch = async (cols: string) => {
      const r = await fetch(
        `${SUPA_URL}/rest/v1/products?select=${cols}&barcode=in.(${encodeURIComponent(inList)})`,
        { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
      )
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return await r.json()
    }
    try { return await tryFetch('barcode,name,option_value,cost,sale_price,season,image_url,category,hq_stock') }
    catch {
      // sale_price 컬럼이 없는 환경 폴백
      try { return await tryFetch('barcode,name,option_value,cost,season,image_url,category,hq_stock') }
      catch {
        try { return await tryFetch('barcode,name,option_value,cost,season,image_url,category') }
        catch { return await tryFetch('barcode,name,option_value,cost') }
      }
    }
  }

  // 4 parallel
  for (let i = 0; i < chunks.length; i += 4) {
    const batch = chunks.slice(i, i + 4)
    const results = await Promise.all(batch.map(fetchChunk))
    results.forEach(arr => { if (Array.isArray(arr)) out.push(...arr) })
  }
  return out
}

function buildBarcodeMapFromProducts(productsRaw: Record<string,unknown>[]): Map<string, ProductInfo> {
  const m = new Map<string, ProductInfo>()
  productsRaw.forEach(r => {
    const bc = String(r['barcode'] || '')
    if (bc) m.set(bc, {
      name:     String(r['name'] || bc),
      option:   String(r['option_value'] || ''),
      cost:      Number(r['cost'] || 0),
      salePrice: Number(r['sale_price'] || 0),
      season:   String(r['season'] || ''),
      imageUrl: String(r['image_url'] || ''),
      category: String(r['category'] || ''),
      hqStock:  Number(r['hq_stock'] || 0),
    })
  })
  return m
}

function buildBarcodeMapFromSales(rows: PersistedData['salesData']): Map<string, ProductInfo> {
  // 캐시된 salesData row에는 productName/cost/season 등이 이미 포함되어 있음 → 재활용
  const m = new Map<string, ProductInfo>()
  for (const r of rows) {
    if (r.barcode && !m.has(r.barcode)) {
      m.set(r.barcode, {
        name:     r.productName,
        option:   r.option || '',
        cost:      Number((r as any).cost || 0),
        salePrice: Number((r as any).salePrice || 0),
        season:   r.season || '',
        imageUrl: r.imageUrl || '',
        category: r.category || '',
        hqStock:  0,
      })
    }
  }
  return m
}

function processSalesRows(
  rawRows: Record<string,unknown>[],
  bcMap: Map<string, ProductInfo>
): PersistedData['salesData'] {
  return rawRows.map(r => {
    const bc = String(r['barcode'] || '')
    const info = bcMap.get(bc) || { name: bc, option: '', cost: 0, salePrice: 0, season: '', imageUrl: '', category: '' }
    const qty = Number(r['quantity'] || 0)
    // VAT 별도
    const costExcl      = vatExcluded(info.cost)        // 원가 (재고액 계산용)
    const salePriceExcl = vatExcluded(info.salePrice)   // 판매가 (판매액 계산용)
    // 판매액 = 판매가 × 수량. 판매가 미입력(0) 시 원가로 폴백 (호환성)
    const unitPrice = salePriceExcl > 0 ? salePriceExcl : costExcl
    return {
      date:        String(r['date']),
      productName: info.name,
      option:      info.option,
      barcode:     bc,
      qty,
      revenue:     unitPrice * qty,
      isReturn:    false,
      season:      info.season,
      imageUrl:    info.imageUrl,
      category:    info.category,
      cost:        costExcl,        // 원가 보존 (재고 계산용)
      salePrice:   salePriceExcl,   // 판매가 보존
    } as any
  })
}

function buildMasterData(salesData: PersistedData['salesData']): PersistedData['masterData'] {
  const seen = new Set<string>()
  return salesData.reduce((acc: Record<string,unknown>[], r) => {
    if (!seen.has(r.productName)) {
      seen.add(r.productName)
      acc.push({ 상품명: r.productName, 옵션: r.option, 바코드: r.barcode || '' })
    }
    return acc
  }, [])
}

export async function loadHistorical(): Promise<HistoricalData | null> {
  if (typeof window === 'undefined') return null
  try {
    const tStart = Date.now()
    const today = new Date().toISOString().slice(0, 10)
    const ninetyAgo = ymdShift(today, -HISTORICAL_DAYS_BACK)

    // 1) 캐시 읽기 (TTL 무시)
    const cached = readHistoricalRaw()
    const canIncremental =
      cached &&
      Array.isArray(cached.salesData) && cached.salesData.length > 0 &&
      typeof cached.lastSyncDate === 'string' && cached.lastSyncDate.length === 10 &&
      ymdDaysBetween(today, cached.lastSyncDate) <= FULL_REFRESH_AFTER_DAYS

    if (canIncremental) {
      // ── 증분 동기화 경로 ──
      const fromDate = ymdShift(cached!.lastSyncDate, 1)
      if (fromDate > today) {
        // 더 가져올 새 데이터 없음
        const trimmed = cached!.salesData.filter(r => r.date >= ninetyAgo)
        console.log(`[CA] historical cache up-to-date (lastSync=${cached!.lastSyncDate}, rows=${trimmed.length})`)
        return { salesData: trimmed, masterData: buildMasterData(trimmed) }
      }

      const newRaw = await fetchAllPages(
        `daily_sales?select=date,barcode,quantity&date=gte.${fromDate}&date=lte.${today}&quantity=gt.0&order=date.asc`
      )
      console.log(`[CA] historical incremental ${fromDate}~${today}: ${newRaw.length}행 (${Date.now()-tStart}ms)`)

      // 캐시 row에서 barcode info 재활용 + 새 barcode만 추가 fetch
      const bcMap = buildBarcodeMapFromSales(cached!.salesData)
      const newBcs = Array.from(new Set(
        (newRaw as Record<string,unknown>[]).map(r => String(r['barcode'] || '')).filter(Boolean)
      ))
      const missing = newBcs.filter(bc => !bcMap.has(bc))
      if (missing.length > 0) {
        const tProd = Date.now()
        const fetched = await fetchProductsByBarcodes(missing)
        buildBarcodeMapFromProducts(fetched).forEach((v, k) => bcMap.set(k, v))
        console.log(`[CA] new products fetched: ${fetched.length} (${Date.now()-tProd}ms)`)
      }

      const newSales = processSalesRows(newRaw as Record<string,unknown>[], bcMap)
      const merged = [...cached!.salesData, ...newSales].filter(r => r.date >= ninetyAgo)
      const masterData = buildMasterData(merged)

      writeHistoricalCache({ salesData: merged, masterData, lastSyncDate: today })
      console.log(`[CA] ✅ incremental done: +${newSales.length}행, total ${merged.length} (${Date.now()-tStart}ms)`)
      return { salesData: merged, masterData }
    }

    // ── Cold load (캐시 없음 or 7일 이상 stale) ──
    const fromLoad = ninetyAgo
    const salesRaw = await fetchAllPages(
      `daily_sales?select=date,barcode,quantity&date=gte.${fromLoad}&date=lte.${today}&quantity=gt.0&order=date.asc`
    )
    console.log(`[CA] historical FULL load: daily_sales ${salesRaw.length}행 (${Date.now()-tStart}ms)`)

    const usedBarcodes = Array.from(new Set(
      (salesRaw as Record<string,unknown>[]).map(r => String(r['barcode'] || '')).filter(Boolean)
    ))
    const tProd = Date.now()
    const productsRaw = await fetchProductsByBarcodes(usedBarcodes)
    console.log(`[CA] products lazy-load ${productsRaw.length}행 (${Date.now()-tProd}ms)`)

    const bcMap = buildBarcodeMapFromProducts(productsRaw)
    const salesData = processSalesRows(salesRaw as Record<string,unknown>[], bcMap)
    const masterData = buildMasterData(salesData)

    writeHistoricalCache({ salesData, masterData, lastSyncDate: today })
    console.log(`[CA] ✅ FULL load done: ${salesData.length}행 (${Date.now()-tStart}ms)`)
    return { salesData, masterData }
  } catch (e) {
    console.warn('[storage] loadHistorical error:', e)
    return null
  }
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
      // VAT 별도: cost(매입가)를 변환하면 revenue(=cost*qty)도 자동 별도 처리됨
      const costExcl = vatExcluded(info.cost)
      return {
        date:        String(r['date']),
        productName: info.name,
        option:      info.option,
        barcode:     bc,
        qty,
        revenue:     costExcl * qty,
        isReturn:    false,
        season:      info.season,
        imageUrl:    info.imageUrl,
        category:    info.category,
        cost:        costExcl,
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

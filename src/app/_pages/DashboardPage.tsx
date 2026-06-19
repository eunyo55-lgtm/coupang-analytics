'use client'
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '@/lib/store'
import { toYMD } from '@/lib/dateUtils'
import { LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine, LabelList } from 'recharts'
import { vatExcluded, VAT_LABEL } from '@/lib/vatUtils'
import { readSwrCache, writeSwrCache } from '@/lib/swrCache'

const SUPABASE_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI'

async function rpc(fn: string, params: Record<string,unknown> = {}, timeoutMs = 30000) {
  // Retries on transient failures (5xx, abort, network) with exponential backoff.
  // 3 attempts total: 0s → 1.2s → 3.6s wait. Per-attempt timeout = timeoutMs.
  const RETRIES = 2
  let lastDetail = ''
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.code) {
          console.warn('[RPC]', fn, data.message)
          return []
        }
        if (attempt > 0) console.log(`[RPC] ${fn} recovered on attempt ${attempt + 1}`)
        return data
      }
      lastDetail = await res.text().catch(()=>'')
      // 5xx (서버 일시 오류, statement timeout 포함) → 재시도. 4xx → 즉시 실패.
      if (res.status >= 500 && attempt < RETRIES) {
        console.warn(`[RPC] ${fn} HTTP ${res.status} — 재시도 ${attempt + 1}/${RETRIES + 1}`)
      } else {
        console.warn(`[RPC] ${fn} HTTP ${res.status}`, lastDetail)
        return []
      }
    } catch (e: any) {
      lastDetail = e?.message || String(e)
      if (attempt < RETRIES) {
        console.warn(`[RPC] ${fn} 네트워크/abort — 재시도 ${attempt + 1}/${RETRIES + 1}:`, lastDetail)
      } else {
        console.warn(`[RPC] ${fn} 최종 실패:`, lastDetail)
        return []
      }
    } finally {
      clearTimeout(tid)
    }
    // 다음 시도 전 백오프 (1.2s, 3.6s). MV 콜드 상태 회복 시간을 충분히 줌.
    await new Promise(r => setTimeout(r, 1200 * Math.pow(3, attempt)))
  }
  return []
}

// ── RPC 결과 캐시 (localStorage, 10분 TTL, stale-while-revalidate) ──
// 같은 파라미터로 자주 호출되는 KPI/TOP 응답을 캐시.
// 캐시 hit 시 즉시 사용하고 백그라운드에서 fresh fetch는 호출부 useEffect가 진행.
// v2: VAT 별도 적용으로 캐시 무효화
const RPC_CACHE_PREFIX = 'ca_rpc2_'
const RPC_CACHE_TTL_MS = 10 * 60 * 1000  // 10분
type CacheEntry<T> = { ts: number; data: T }

function cacheKey(fn: string, params: Record<string,unknown>): string {
  return RPC_CACHE_PREFIX + fn + ':' + JSON.stringify(params)
}
function readRpcCache<T = unknown>(fn: string, params: Record<string,unknown>): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(cacheKey(fn, params))
    if (!raw) return null
    const c = JSON.parse(raw) as CacheEntry<T>
    if (Date.now() - c.ts > RPC_CACHE_TTL_MS) return null
    return c.data
  } catch { return null }
}
function writeRpcCache(fn: string, params: Record<string,unknown>, data: unknown) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(cacheKey(fn, params), JSON.stringify({ ts: Date.now(), data }))
  } catch { /* quota / serialize 실패 무시 */ }
}

// rpc() + 캐시 래퍼. 캐시가 있어도 호출부는 fresh fetch를 따로 트리거할 수 있음.
async function rpcCached(fn: string, params: Record<string,unknown> = {}, opts: { forceFresh?: boolean; timeoutMs?: number } = {}) {
  if (!opts.forceFresh) {
    const cached = readRpcCache(fn, params)
    if (cached !== null) return cached
  }
  const fresh = await rpc(fn, params, opts.timeoutMs ?? 30000)
  if (Array.isArray(fresh) && fresh.length > 0) writeRpcCache(fn, params, fresh)
  return fresh
}

// ── 판매 추이 모달: 특정 상품의 3개년 일별 판매량을 RPC로 조회 ──
function SalesTrendModal({ productName, onClose }: { productName: string; onClose: () => void }) {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const [trendData, setTrendData] = useState<{date:string;'26년':number;'25년':number;'24년':number}[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!productName) return
    setLoading(true)

    const end = new Date()
    const start = new Date(); start.setDate(start.getDate() - 59)
    const from26 = toYMD(start), to26 = toYMD(end)
    const from25 = from26.replace('2026','2025'), to25 = to26.replace('2026','2025')
    const from24 = from26.replace('2026','2024'), to24 = to26.replace('2026','2024')

    // sale_date가 timestamp 문자열로 올 수도 있어 항상 'YYYY-MM-DD'로 잘라야 함
    const ymd = (v: unknown) => String(v ?? '').slice(0, 10)

    Promise.all([
      rpc('get_daily_sales_by_name', { p_name: productName, p_from: from26, p_to: to26 }),
      rpc('get_daily_sales_by_name', { p_name: productName, p_from: from25, p_to: to25 }),
      rpc('get_daily_sales_by_name', { p_name: productName, p_from: from24, p_to: to24 }),
    ]).then(([data26, data25, data24]) => {
      const map26 = new Map<string,number>()
      const map25 = new Map<string,number>()
      const map24 = new Map<string,number>()

      ;(Array.isArray(data26) ? data26 : []).forEach((r:{sale_date:string;total_qty:number}) =>
        map26.set(ymd(r.sale_date), r.total_qty)
      )
      ;(Array.isArray(data25) ? data25 : []).forEach((r:{sale_date:string;total_qty:number}) =>
        map25.set(ymd(r.sale_date).replace('2025','2026'), r.total_qty)
      )
      ;(Array.isArray(data24) ? data24 : []).forEach((r:{sale_date:string;total_qty:number}) =>
        map24.set(ymd(r.sale_date).replace('2024','2026'), r.total_qty)
      )

      // 날짜 축 생성 (from26 ~ to26)
      const dates: string[] = []
      const cur = new Date(start)
      while (cur <= end) { dates.push(toYMD(cur)); cur.setDate(cur.getDate() + 1) }

      const result = dates
        .map(d => ({ date: d.slice(5), '26년': map26.get(d)||0, '25년': map25.get(d)||0, '24년': map24.get(d)||0 }))
        .filter(d => d['26년'] || d['25년'] || d['24년'])

      setTrendData(result)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [productName])

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'#ffffff',borderRadius:'var(--r12)',padding:24,width:'min(720px,95vw)',boxShadow:'0 20px 60px rgba(0,0,0,0.4)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div><div style={{fontWeight:800,fontSize:15}}>📈 판매 추이</div><div style={{fontSize:12,color:'var(--t3)',marginTop:2}}>{productName}</div></div>
          <button onClick={onClose} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12}}>✕ 닫기</button>
        </div>
        {loading ? (
          <div style={{textAlign:'center',padding:40,color:'var(--t3)'}}>로딩 중...</div>
        ) : trendData.length>0?(
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{top:4,right:16,left:0,bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="date" tick={{fontSize:9}} interval="preserveStartEnd"/>
              <YAxis tick={{fontSize:9}} width={36}/>
              <Tooltip formatter={(val:number,name:string)=>[fmt(val)+'개',name]}/>
              <Legend iconType="circle" iconSize={7} wrapperStyle={{fontSize:10}}/>
              <Line type="monotone" dataKey="26년" stroke="#1D4ED8" strokeWidth={2.5} dot={false}/>
              <Line type="monotone" dataKey="25년" stroke="#7C3AED" strokeWidth={2} dot={false} strokeDasharray="5 3"/>
              <Line type="monotone" dataKey="24년" stroke="#065F46" strokeWidth={2} dot={false} strokeDasharray="2 2"/>
            </LineChart>
          </ResponsiveContainer>
        ):<div style={{textAlign:'center',padding:40,color:'var(--t3)'}}>데이터 없음</div>}
      </div>
    </div>
  )
}

function StockTrendModal({ productName, stockHistory, onClose }: { productName:string; stockHistory:{week:string;qty:number}[]; onClose:()=>void }) {
  const fmt = (n:number) => Math.round(n).toLocaleString('ko-KR')
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'#ffffff',borderRadius:'var(--r12)',padding:24,width:'min(600px,95vw)',boxShadow:'0 20px 60px rgba(0,0,0,0.4)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div><div style={{fontWeight:800,fontSize:15}}>📦 재고 추이</div><div style={{fontSize:12,color:'var(--t3)',marginTop:2}}>{productName}</div></div>
          <button onClick={onClose} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12}}>✕ 닫기</button>
        </div>
        {stockHistory.length>0?(
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stockHistory} margin={{top:4,right:16,left:0,bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="week" tick={{fontSize:9}}/>
              <YAxis tick={{fontSize:9}} width={40}/>
              <Tooltip formatter={(val:number)=>[fmt(val)+'개','재고']}/>
              <Bar dataKey="qty" fill="#3B82F6" radius={[4,4,0,0]} name="재고량"/>
            </BarChart>
          </ResponsiveContainer>
        ):<div style={{textAlign:'center',padding:40,color:'var(--t3)'}}>재고 데이터 없음</div>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { state } = useApp()
  const fmt = (n:number) => Math.round(n).toLocaleString('ko-KR')
  const latestDate = state.latestSaleDate || toYMD(new Date(Date.now()-86400000))
  const weekRange = useMemo(()=>{
    const d=new Date(latestDate), dow=d.getDay()
    // 가장 최근 완료된 목요일 (금~목 사이클 종료). 오늘이 목요일이면 그 전 주 목요일.
    const back = (dow + 3) % 7 || 7
    const lastThu=new Date(d); lastThu.setDate(d.getDate() - back)
    const lastFri=new Date(lastThu); lastFri.setDate(lastThu.getDate()-6)
    return {from:toYMD(lastFri),to:toYMD(lastThu)}
  },[latestDate])
  const cumRange = {from:'2026-01-01',to:latestDate}

  const [kpiYest,setKpiYest]=useState<{qty:number,rev:number}|null>(null)
  const [kpiWeek,setKpiWeek]=useState<{qty:number,rev:number}|null>(null)
  const [kpiCum,setKpiCum]=useState<{qty:number,rev:number}|null>(null)
  const [kpiYest25,setKpiYest25]=useState<{qty:number,rev:number}|null>(null)
  const [kpiWeek25,setKpiWeek25]=useState<{qty:number,rev:number}|null>(null)
  const [kpiCum25,setKpiCum25]=useState<{qty:number,rev:number}|null>(null)
  const [chartFrom,setChartFrom]=useState('')
  const [chartTo,setChartTo]=useState('')
  const [topFrom,setTopFrom]=useState('')
  const [topTo,setTopTo]=useState('')
  type TopProduct={product_name:string;image_url:string;total_qty:number;total_revenue:number;qty_24?:number;qty_25?:number;qty_26?:number}
  const [topProducts,setTopProducts]=useState<TopProduct[]>([])
  const [topStock,setTopStock]=useState<{product_name:string;image_url:string;total_stock:number;stock_value:number;prev_week_stock?:number}[]>([])
  // 전체 재고 WoW 계산용 — 표시용 TOP10과 분리 (TOP10은 입고 큰 신상에 편향)
  const [stockWoWRaw,setStockWoWRaw]=useState<{total_stock:number;prev_week_stock?:number}[]>([])
  const [loadingTop,setLoadingTop]=useState(false)
  const [salesModal,setSalesModal]=useState<string|null>(null)
  const [stockModal,setStockModal]=useState<{name:string;history:{week:string;qty:number}[]}|null>(null)
  type TopPreset = 'yesterday' | 'week' | 'month' | 'ytd'
  const [topPreset, setTopPreset] = useState<TopPreset>('week')
  // MV 자동 갱신: stale 감지 시 백그라운드 호출 + 완료 후 KPI 재조회
  const [autoRefreshing, setAutoRefreshing] = useState(false)
  const [autoRefreshed, setAutoRefreshed] = useState(false)
  const [kpiRefetchTick, setKpiRefetchTick] = useState(0)

  // 공급 KPI용 supply_status raw 데이터 (SWR 캐시 + 병렬 fetch)
  // 공급 데이터는 하루 1-2회만 업로드되므로 TTL을 길게 (6시간) 두고,
  // 캐시가 있으면 즉시 표시 + 백그라운드 갱신 (사용자 대기 없음)
  type SupplyRaw = { 입고예정일: string; 확정수량: number; 입고수량: number; 매입가: number }
  const SUPPLY_CACHE_KEY = 'swr_dash_supply_v2'
  const SUPPLY_TTL = 6 * 60 * 60 * 1000  // 6시간 (공급 데이터 업로드 주기)

  // 옛 v1 키 잔존 청소 (마이그레이션 - 일회성)
  if (typeof window !== 'undefined') {
    try { localStorage.removeItem('swr_dash_supply_v1') } catch { /* ignore */ }
  }
  const _initialSupply = typeof window !== 'undefined' ? readSwrCache<SupplyRaw[]>(SUPPLY_CACHE_KEY, SUPPLY_TTL) : null
  // 캐시 데이터가 너무 오래된 경우 자동 stale 처리 (매일 업로드 가정 → 3일 이상 차이면 옛 데이터)
  const todayYmdStr = (() => { const t=new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}` })()
  const cacheMaxDate = _initialSupply
    ? _initialSupply.data.reduce((m, r) => {
        const d = (r.입고예정일 || '').slice(0,10)
        return d && d <= todayYmdStr && d > m ? d : m
      }, '')
    : ''
  const cacheTooOld = cacheMaxDate && (() => {
    const t = new Date(todayYmdStr).getTime()
    const m = new Date(cacheMaxDate).getTime()
    return (t - m) > 3 * 86400000
  })()

  const [supplyRaw, setSupplyRaw] = useState<SupplyRaw[]>(_initialSupply?.data ?? [])
  // 캐시 데이터가 있으면 loading=false (즉시 표시) — 다만 cacheTooOld 면 백그라운드 갱신 트리거
  const [supplyLoading, setSupplyLoading] = useState(!_initialSupply || _initialSupply.data.length === 0)

  // 대시보드 진입 시 supply_status 로드
  //  - 캐시 신선 + 데이터 최신 (3일 이내): 백그라운드 fetch 완전 생략
  //  - 캐시 stale 또는 데이터 오래됨: 백그라운드 fetch
  useEffect(() => {
    // 캐시 fresh + 데이터 최신 → 백그라운드 fetch 생략
    if (_initialSupply && !_initialSupply.stale && _initialSupply.data.length > 0 && !cacheTooOld) {
      return
    }
    let cancelled = false
    async function load() {
      const yearStart = `${new Date().getFullYear()}-01-01`
      const PAGE = 1000
      const CONCURRENCY = 16
      const all: SupplyRaw[] = []
      let nextOffset = 0
      let done = false
      while (!done) {
        const offsets = Array.from({ length: CONCURRENCY }, (_, i) => nextOffset + i * PAGE)
        const results = await Promise.all(offsets.map(async off => {
          try {
            const url = `${SUPABASE_URL}/rest/v1/supply_status?select=입고예정일,확정수량,입고수량,매입가&입고예정일=gte.${yearStart}&order=입고예정일.asc&limit=${PAGE}&offset=${off}`
            const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
            if (!res.ok) return [] as SupplyRaw[]
            return (await res.json()) as SupplyRaw[]
          } catch { return [] as SupplyRaw[] }
        }))
        for (const arr of results) {
          if (Array.isArray(arr) && arr.length > 0) {
            all.push(...arr.map(r => ({
              ...r,
              확정수량: Number(r.확정수량 || 0),
              입고수량: Number(r.입고수량 || 0),
              매입가: vatExcluded(Number(r.매입가 || 0)),
            })))
          }
          if (!arr || arr.length < PAGE) done = true
        }
        nextOffset += CONCURRENCY * PAGE
        if (all.length > 200000) break  // safety cap
      }
      if (!cancelled) {
        setSupplyRaw(all)
        setSupplyLoading(false)
        writeSwrCache(SUPPLY_CACHE_KEY, all)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // 프리셋에서 (from, to) 계산 — latestDate 기준
  function rangeFromPreset(p: TopPreset, anchor: string): { from: string; to: string } {
    if (!anchor) return { from: '', to: '' }
    const a = new Date(anchor + 'T00:00:00')
    if (p === 'yesterday') return { from: anchor, to: anchor }
    if (p === 'week') {
      const d = new Date(a); d.setDate(d.getDate() - 6)
      return { from: toYMD(d), to: anchor }
    }
    if (p === 'month') {
      const d = new Date(a); d.setDate(d.getDate() - 29)
      return { from: toYMD(d), to: anchor }
    }
    // ytd: 1/1 ~ latestDate
    const y = a.getFullYear()
    return { from: `${y}-01-01`, to: anchor }
  }

  // latestDate 로드 후 차트/TOP 기간 초기화
  useEffect(()=>{
    if(!latestDate) return
    const d=new Date(latestDate); d.setDate(d.getDate()-30)
    setChartFrom(toYMD(d)); setChartTo(latestDate)
    // TOP은 프리셋에서 계산
    const r = rangeFromPreset(topPreset, latestDate)
    setTopFrom(r.from); setTopTo(r.to)
  },[latestDate])

  // 프리셋 변경 시 TOP 기간 재계산
  useEffect(()=>{
    if(!latestDate) return
    const r = rangeFromPreset(topPreset, latestDate)
    setTopFrom(r.from); setTopTo(r.to)
  },[topPreset, latestDate])

  useEffect(()=>{
    if(!latestDate) return
    let cancelled = false
    const d25=latestDate.replace('2026','2025')
    const w25f=weekRange.from.replace('2026','2025'), w25t=weekRange.to.replace('2026','2025')
    const c25t=cumRange.to.replace('2026','2025')

    const pickRow = (val: unknown): {total_qty?:number;total_revenue?:number} | null => {
      if (!Array.isArray(val) || val.length === 0) return null
      return val[0] as {total_qty?:number;total_revenue?:number}
    }
    const pickFromSettled = (res: PromiseSettledResult<unknown>): {total_qty?:number;total_revenue?:number} | null => {
      if (res.status !== 'fulfilled') { console.warn('[KPI] RPC rejected:', res.reason); return null }
      return pickRow(res.value)
    }
    const toKpi = (row: {total_qty?:number;total_revenue?:number}|null) =>
      row ? { qty: Number(row.total_qty||0), rev: vatExcluded(Number(row.total_revenue||0)) } : null

    // Param 묶음 정의 — 캐시 lookup과 fresh fetch 모두에서 동일하게 사용
    const calls: Array<[string, Record<string,unknown>]> = [
      ['get_kpi_by_date', { target_date: latestDate }],
      ['get_kpi_range',   { date_from: weekRange.from, date_to: weekRange.to }],
      ['get_kpi_range',   { date_from: cumRange.from,  date_to: cumRange.to }],
      ['get_kpi_by_date', { target_date: d25 }],
      ['get_kpi_range',   { date_from: w25f, date_to: w25t }],
      ['get_kpi_range',   { date_from: '2025-01-01', date_to: c25t }],
    ]

    // 1) 캐시 hit이면 즉시 표시 — 사용자 체감 로딩 0초
    const cachedRows = calls.map(([fn, p]) => pickRow(readRpcCache(fn, p)))
    if (cachedRows.some(r => r !== null)) {
      const [yKpi, wKpi, cKpi, y25Kpi, w25Kpi, c25Kpi] = cachedRows.map(toKpi)
      if (yKpi)   setKpiYest(yKpi)
      if (wKpi)   setKpiWeek(wKpi)
      if (cKpi)   setKpiCum(cKpi)
      if (y25Kpi) setKpiYest25(y25Kpi)
      if (w25Kpi) setKpiWeek25(w25Kpi)
      if (c25Kpi) setKpiCum25(c25Kpi)
    }

    // 2) 백그라운드에서 fresh fetch (캐시 갱신용). 실패해도 캐시 값 유지.
    Promise.allSettled(calls.map(([fn, p]) => rpc(fn, p))).then(results => {
      if (cancelled) return
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) {
          writeRpcCache(calls[i][0], calls[i][1], r.value)
        }
      })
      const [y, w, c, y25, w25, c25] = results
      const yKpi = toKpi(pickFromSettled(y))
      const wKpi = toKpi(pickFromSettled(w))
      const cKpi = toKpi(pickFromSettled(c))
      const y25Kpi = toKpi(pickFromSettled(y25))
      const w25Kpi = toKpi(pickFromSettled(w25))
      const c25Kpi = toKpi(pickFromSettled(c25))
      if (yKpi)   setKpiYest(yKpi)
      if (wKpi)   setKpiWeek(wKpi)
      if (cKpi)   setKpiCum(cKpi)
      if (y25Kpi) setKpiYest25(y25Kpi)
      if (w25Kpi) setKpiWeek25(w25Kpi)
      if (c25Kpi) setKpiCum25(c25Kpi)
    })
    return () => { cancelled = true }
    // kpiRefetchTick: MV 자동 갱신 후 KPI 재조회 트리거
  },[latestDate,weekRange.from,weekRange.to,cumRange.from,cumRange.to,kpiRefetchTick])

  useEffect(()=>{
    // latestDate 로드되기 전에는 호출 스킵 (race condition 방지)
    if(!latestDate) return
    if(!topFrom||!topTo) return
    let cancelled = false
    setLoadingTop(true)
    const from24=topFrom.replace('2026','2024'), to24=topTo.replace('2026','2024')
    const from25=topFrom.replace('2026','2025'), to25=topTo.replace('2026','2025')

    type Stock = {product_name:string;image_url:string;total_stock:number;stock_value:number;prev_week_stock?:number}

    const arrFromSettled = <T,>(r: PromiseSettledResult<unknown>): T[] => {
      if (r.status !== 'fulfilled') { console.warn('[TOP] rejected:', r.reason); return [] }
      return Array.isArray(r.value) ? (r.value as T[]) : []
    }
    const arrFromCache = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

    const calls: Array<[string, Record<string,unknown>]> = [
      ['get_top_products', { date_from: topFrom, date_to: topTo, top_n: 10 }],
      ['get_top_products', { date_from: from25, date_to: to25, top_n: 30 }],
      ['get_top_products', { date_from: from24, date_to: to24, top_n: 30 }],
      ['get_top_stock',    { top_n: 10 }],
      ['get_top_stock',    { top_n: 500 }],   // 전체 재고 WoW 계산용 (TOP10 편향 회피)
    ]
    const applyAll = (p26: TopProduct[], p25: TopProduct[], p24: TopProduct[], stocks: Stock[], stocksFull: Stock[]) => {
      const map25=new Map<string,number>(); p25.forEach(r=>map25.set(r.product_name,r.total_qty))
      const map24=new Map<string,number>(); p24.forEach(r=>map24.set(r.product_name,r.total_qty))
      // 매출/재고액 모든 금액에 VAT 별도 적용
      const xp = (r: TopProduct) => ({ ...r, total_revenue: vatExcluded(r.total_revenue) })
      setTopProducts(p26.map(r=>({...xp(r),qty_26:r.total_qty,qty_25:map25.get(r.product_name)||0,qty_24:map24.get(r.product_name)||0})))
      setTopStock(stocks.map(s=>({ ...s, stock_value: vatExcluded(s.stock_value) })))
      setStockWoWRaw(stocksFull.map(s => ({ total_stock: s.total_stock, prev_week_stock: s.prev_week_stock })))
    }

    // 1) 캐시가 있으면 즉시 표시
    const c26 = arrFromCache<TopProduct>(readRpcCache(calls[0][0], calls[0][1]))
    const c25 = arrFromCache<TopProduct>(readRpcCache(calls[1][0], calls[1][1]))
    const c24 = arrFromCache<TopProduct>(readRpcCache(calls[2][0], calls[2][1]))
    const cStk = arrFromCache<Stock>(readRpcCache(calls[3][0], calls[3][1]))
    const cStkFull = arrFromCache<Stock>(readRpcCache(calls[4][0], calls[4][1]))
    if (c26.length > 0 || cStk.length > 0) {
      applyAll(c26, c25, c24, cStk, cStkFull)
      setLoadingTop(false)  // 캐시 즉시 표시되었으니 스피너 끔 (백그라운드 새 fetch는 진행)
    }

    // 2) fresh fetch — 캐시 저장 + 화면 갱신
    Promise.allSettled(calls.map(([fn, p]) => rpc(fn, p))).then(results => {
      if (cancelled) return  // 최신 요청이 아니면 무시
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) {
          writeRpcCache(calls[i][0], calls[i][1], r.value)
        }
      })
      const [r26,r25,r24,rs,rsFull] = results
      const p26 = arrFromSettled<TopProduct>(r26)
      const p25 = arrFromSettled<TopProduct>(r25)
      const p24 = arrFromSettled<TopProduct>(r24)
      const stocks = arrFromSettled<Stock>(rs)
      const stocksFull = arrFromSettled<Stock>(rsFull)
      applyAll(p26, p25, p24, stocks, stocksFull)
      setLoadingTop(false)
    })
    return () => { cancelled = true }
  },[latestDate,topFrom,topTo])

  const yoyChartData=useMemo(()=>{
    const m26=new Map<string,number>(), m25=new Map<string,number>(), m24=new Map<string,number>()
    state.daily26.forEach(r=>{if(r.date>=chartFrom&&r.date<=chartTo)m26.set(r.date,r.qty)})
    state.daily25.forEach(r=>{const m=r.date.replace('2025','2026'),f=chartFrom.replace('2026','2025'),t=chartTo.replace('2026','2025');if(r.date>=f&&r.date<=t)m25.set(m,r.qty)})
    state.daily24.forEach(r=>{const m=r.date.replace('2024','2026'),f=chartFrom.replace('2026','2024'),t=chartTo.replace('2026','2024');if(r.date>=f&&r.date<=t)m24.set(m,r.qty)})
    const dates:string[]=[],cur=new Date(chartFrom),end=new Date(chartTo)
    while(cur<=end){dates.push(toYMD(cur));cur.setDate(cur.getDate()+1)}
    return dates.map(d=>({date:d.slice(5),'26년':m26.get(d)||0,'25년':m25.get(d)||0,'24년':m24.get(d)||0})).filter(d=>d['26년']||d['25년']||d['24년'])
  },[state.daily26,state.daily25,state.daily24,chartFrom,chartTo])

  const supplyChartData=useMemo(()=>{
    const orders=state.ordersData as Record<string,unknown>[]
    if(!orders.length) return []
    const mm=new Map<string,{order:number;confirmed:number;received:number}>()
    orders.forEach(r=>{
      const ds=String(r['order_date']||'');if(!ds)return
      const mo=ds.slice(0,7),cur=mm.get(mo)||{order:0,confirmed:0,received:0}
      cur.order+=Number(r['order_qty']||0);cur.confirmed+=Number(r['confirmed_qty']||0);cur.received+=Number(r['received_qty']||0)
      mm.set(mo,cur)
    })
    return Array.from(mm.entries()).sort(([a],[b])=>a.localeCompare(b)).slice(-12)
      .map(([mo,v])=>({month:mo.slice(2),발주수량:v.order,공급수량:v.confirmed,입고수량:v.received}))
  },[state.ordersData])

  const totalSales26=useMemo(()=>topProducts.reduce((s,r)=>s+(r.qty_26||0),0),[topProducts])
  const totalStock=useMemo(()=>topStock.reduce((s,r)=>s+r.total_stock,0),[topStock])
  // 전체 재고 WoW% — TOP500 기준 (전체의 ~85% 커버. TOP10 한정 시 신상 입고 편향이 큼)
  const stockWoWPct = useMemo(() => {
    if (stockWoWRaw.length === 0) return null
    const cur = stockWoWRaw.reduce((s, r) => s + (r.total_stock || 0), 0)
    const prev = stockWoWRaw.reduce((s, r) => s + (r.prev_week_stock || 0), 0)
    return prev > 0 ? Math.round((cur - prev) / prev * 100) : null
  }, [stockWoWRaw])
  const pct=(now:number,prev:number)=>prev?Math.round((now-prev)/prev*100):0
  const s=state.stockSummary
  const stockValueMaster  = vatExcluded((s as {stock_value_master?:number}).stock_value_master  ?? s.stock_value)
  const stockValueCoupang = vatExcluded((s as {stock_value_coupang?:number}).stock_value_coupang ?? 0)
  const [stockCostSrc, setStockCostSrc] = useState<'master'|'coupang'>('coupang')
  const displayedStockValue = stockCostSrc === 'master' ? stockValueMaster : (stockValueCoupang || stockValueMaster)

  // ── daily26 폴백: get_kpi_by_date/range가 의존하는 MV(mv_daily_kpi)는 stale일 수 있음.
  //    daily26은 raw daily_sales 테이블 기반이라 항상 신선 → qty만이라도 보장.
  //    rev는 MV에서만 옴 → MV가 stale이면 null. UI에서 "—" + "MV 미갱신" 안내.
  const dailyMap = useMemo(() => new Map(state.daily26.map(d => [d.date, d.qty])), [state.daily26])
  const yestQtyFallback = dailyMap.get(latestDate) ?? null
  const weekQtyFallback = useMemo(() => {
    let sum = 0
    for (const d of state.daily26) {
      if (d.date >= weekRange.from && d.date <= weekRange.to) sum += d.qty
    }
    return sum || null
  }, [state.daily26, weekRange.from, weekRange.to])
  const cumQtyFallback = useMemo(() => {
    let sum = 0
    for (const d of state.daily26) {
      if (d.date >= cumRange.from && d.date <= cumRange.to) sum += d.qty
    }
    return sum || null
  }, [state.daily26, cumRange.from, cumRange.to])

  // 같은 방식으로 25년/24년 폴백 (전년비 계산용)
  const dailyMap25 = useMemo(() => new Map(state.daily25.map(d => [d.date, d.qty])), [state.daily25])
  const d25 = latestDate.replace('2026','2025')
  const yestQtyFallback25 = dailyMap25.get(d25) ?? null

  // 최종 표시값: RPC가 비면 daily 폴백 사용 (qty만)
  const yestQtyEff = kpiYest?.qty ?? yestQtyFallback
  const yestRevEff = kpiYest?.rev ?? null
  const weekQtyEff = kpiWeek?.qty ?? weekQtyFallback
  const weekRevEff = kpiWeek?.rev ?? null
  const cumQtyEff  = kpiCum?.qty  ?? cumQtyFallback
  const cumRevEff  = kpiCum?.rev  ?? null
  const yestYoyEff = (kpiYest?.qty && kpiYest25?.qty) ? pct(kpiYest.qty, kpiYest25.qty)
                   : (yestQtyFallback && yestQtyFallback25) ? pct(yestQtyFallback, yestQtyFallback25)
                   : null
  const usingFallback = (kpiYest === null && yestQtyFallback !== null)
                     || (kpiWeek === null && weekQtyFallback !== null)
                     || (kpiCum === null && cumQtyFallback !== null)

  // ── 자동 MV 갱신: stale 감지하면 백그라운드에서 refresh API 호출, 완료 후 KPI 재조회 ──
  useEffect(() => {
    if (!usingFallback) return
    if (autoRefreshing || autoRefreshed) return
    setAutoRefreshing(true)
    fetch('/api/cron/refresh-mv', { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})))
      .then(j => {
        console.log('[CA] auto MV refresh result:', j)
        // 캐시 무효화: refresh 후 stale 캐시가 다시 표시되지 않게
        try {
          Object.keys(localStorage).forEach(k => {
            if (k.startsWith('ca_rpc2_get_kpi') || k.startsWith('ca_rpc_get_kpi')) localStorage.removeItem(k)
          })
        } catch {}
        setAutoRefreshed(true)
        setKpiRefetchTick(t => t + 1)
      })
      .catch(e => {
        console.warn('[CA] auto MV refresh failed:', e)
        setAutoRefreshed(true)  // 실패해도 더는 시도 안 함 (무한 루프 방지)
      })
      .finally(() => setAutoRefreshing(false))
  }, [usingFallback, autoRefreshing, autoRefreshed])

  const kpiCards:{label:string;sub:string;qty:number|null;rev:number|null;yoy:number|null;yoyLabel?:string;color:string;isStock:boolean;revMissing?:boolean}[]=[
    {label:'판매량',sub:`전일 (${latestDate})`,qty:yestQtyEff,rev:yestRevEff,yoy:yestYoyEff,color:'var(--blue)',isStock:false,revMissing:kpiYest===null},
    {label:'주간 판매량',sub:`${weekRange.from.slice(5)} ~ ${weekRange.to.slice(5)} (금~목)`,qty:weekQtyEff,rev:weekRevEff,yoy:kpiWeek&&kpiWeek25?pct(kpiWeek.qty,kpiWeek25.qty):null,color:'var(--purple)',isStock:false,revMissing:kpiWeek===null},
    {label:'누적 판매량',sub:`${cumRange.from.slice(5)} ~ ${latestDate.slice(5)} (26년)`,qty:cumQtyEff,rev:cumRevEff,yoy:kpiCum&&kpiCum25?pct(kpiCum.qty,kpiCum25.qty):null,color:'var(--green)',isStock:false,revMissing:kpiCum===null},
    {label:'전일 재고',sub:`쿠팡 재고 (${latestDate})`,qty:s.total_stock||null,rev:displayedStockValue||null,yoy:stockWoWPct,yoyLabel:'전주대비',color:'var(--amber)',isStock:true},
  ]

  // ── 공급 KPI 4개 계산 (입고예정일 기준, 확정수량 + 확정금액) ──
  // 공급 KPI는 supplyRaw 만 의존 — sales 의 latestDate 와 분리 (캐시 즉시 표시)
  // 전일/주간/누적 기준 날짜: 판매 KPI 와 동일하게 달력 어제 (TODAY-1) 사용 → 라벨 일관성
  const supplyKpis = useMemo(() => {
    const todayObj = new Date()
    const todayStr = toYMD(todayObj)
    // 어제 (calendar) — 판매 latestDate 가 보통 어제이므로 일관됨
    const yObj = new Date(todayObj.getTime() - 86400000)
    const supplyLatest = toYMD(yObj)
    // 주간: 어제 기준 가장 최근 완료된 목요일 (금~목 사이클 종료)
    const dow = yObj.getDay()
    const back = (dow + 3) % 7 || 7
    const lastThu = new Date(yObj); lastThu.setDate(yObj.getDate() - back)
    const lastFri = new Date(lastThu); lastFri.setDate(lastThu.getDate() - 6)
    const weekFrom = toYMD(lastFri), weekTo = toYMD(lastThu)
    // 누적: 올해 1/1 ~ 어제
    const cumFrom = `${yObj.getFullYear()}-01-01`, cumTo = supplyLatest

    const acc = (filter: (r: SupplyRaw) => boolean) => {
      let qty = 0, amt = 0
      for (const r of supplyRaw) {
        if (filter(r)) {
          const q = Number(r.확정수량 || 0)
          qty += q
          amt += q * Number(r.매입가 || 0)
        }
      }
      return { qty, amt }
    }
    return {
      latest: supplyLatest,
      weekFrom, weekTo,
      cumFrom, cumTo,
      yest:   acc(r => (r.입고예정일 || '').slice(0,10) === supplyLatest),
      week:   acc(r => { const d = (r.입고예정일 || '').slice(0,10); return d >= weekFrom && d <= weekTo }),
      cum:    acc(r => { const d = (r.입고예정일 || '').slice(0,10); return d >= cumFrom && d <= cumTo }),
      moving: (() => {
        let qty = 0, amt = 0
        for (const r of supplyRaw) {
          const d = (r.입고예정일 || '').slice(0,10)
          if (d >= todayStr && Number(r.입고수량 || 0) === 0) {
            const q = Number(r.확정수량 || 0)
            qty += q
            amt += q * Number(r.매입가 || 0)
          }
        }
        return { qty, amt }
      })(),
    }
  }, [supplyRaw])

  const supplyKpiCards: {label:string;sub:string;qty:number;rev:number;color:string}[] = [
    {label:'전일 공급량', sub:`확정 (${supplyKpis.latest})`, qty:supplyKpis.yest.qty, rev:supplyKpis.yest.amt, color:'var(--blue)'},
    {label:'주간 공급량', sub:`${supplyKpis.weekFrom.slice(5)} ~ ${supplyKpis.weekTo.slice(5)} (금~목)`, qty:supplyKpis.week.qty, rev:supplyKpis.week.amt, color:'var(--purple)'},
    {label:'누적 공급량', sub:`${supplyKpis.cumFrom.slice(5)} ~ ${supplyKpis.cumTo.slice(5)} (26년)`, qty:supplyKpis.cum.qty, rev:supplyKpis.cum.amt, color:'var(--green)'},
    {label:'이동중 공급', sub:`미입고 · 예정일 ${toYMD(new Date()).slice(5)} 이후`, qty:supplyKpis.moving.qty, rev:supplyKpis.moving.amt, color:'var(--amber)'},
  ]

  return (
    <div>
      <div style={{
        display:'inline-block', fontSize:10, color:'#64748b', background:'#f1f5f9',
        padding:'2px 8px', borderRadius:999, marginBottom:6, fontWeight:600,
      }} title="매출/재고액/광고비/매입가 모두 부가세 별도 기준으로 표시됩니다.">
        💱 모든 금액 표시: {VAT_LABEL}
      </div>
      {(usingFallback || autoRefreshing) && (
        <div style={{
          background: autoRefreshing ? '#dbeafe' : '#fef3c7',
          border: `1px solid ${autoRefreshing ? '#93c5fd' : '#fcd34d'}`,
          borderRadius:8, padding:'8px 12px', marginBottom:10, fontSize:11,
          color: autoRefreshing ? '#1e40af' : '#78350f',
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap'
        }}>
          <span>
            {autoRefreshing ? (
              <>🔄 <b>최신 매출액을 자동 갱신 중</b>입니다... (5~15초). 완료되면 매출(원)이 자동 표시됩니다.</>
            ) : (
              <>⚠️ 최신 일자의 <b>매출액 자동 갱신에 실패</b>했습니다. 판매수량은 정확하지만 매출(원)은 "—"로 표시됩니다.</>
            )}
          </span>
          {!autoRefreshing && (
            <button
              onClick={() => {
                setAutoRefreshed(false)  // 재시도 허용
                setKpiRefetchTick(t => t + 1)
              }}
              style={{padding:'4px 10px', background:'#f59e0b', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap'}}
            >🔄 다시 시도</button>
          )}
        </div>
      )}
      <div className="ds-row" style={{marginBottom:16}}>
        {kpiCards.map((c,i)=>(
          <div key={i} className={`ds-card ds-c${i+1}`}>
            <div className="ds-lbl" style={{fontSize:11}}>{c.label}</div>
            <div style={{fontSize:9,color:'var(--t3)',marginBottom:4}}>{c.sub}</div>
            <div className="ds-val" style={{color:c.color,fontSize:22}}>{c.qty===null?<span style={{fontSize:13,color:'var(--t3)'}}>로딩...</span>:fmt(c.qty)}</div>
            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',margin:'3px 0',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}} title={c.revMissing?'mv_daily_kpi 갱신 대기':VAT_LABEL}>
              {c.isStock ? (
                <>
                  <span>재고액 {c.rev!==null ? Math.round((c.rev||0)/100000000*10)/10+'억' : '—'}</span>
                  <div style={{display:'flex',gap:3}}>
                    <button onClick={()=>setStockCostSrc('master')}
                      style={{fontSize:9,padding:'2px 6px',borderRadius:4,cursor:'pointer',fontWeight:700,border:'1px solid var(--border)',
                        background:stockCostSrc==='master'?'var(--amber)':'var(--bg)',color:stockCostSrc==='master'?'#fff':'var(--t3)'}}
                      title="상품마스터(이지어드민) 원가 기준">마스터</button>
                    <button onClick={()=>setStockCostSrc('coupang')}
                      style={{fontSize:9,padding:'2px 6px',borderRadius:4,cursor:'pointer',fontWeight:700,border:'1px solid var(--border)',
                        background:stockCostSrc==='coupang'?'var(--amber)':'var(--bg)',color:stockCostSrc==='coupang'?'#fff':'var(--t3)'}}
                      title="쿠팡 허브 매입가 기준">쿠팡</button>
                  </div>
                </>
              ) : c.rev !== null ? (
                <>매출 {fmt(c.rev||0)}원</>
              ) : (
                <>매출 <span style={{color:'#f59e0b'}}>— 집계중</span></>
              )}
            </div>
            {c.yoy!==null&&<div className={c.yoy>=0?'diff-up':'diff-dn'} style={{fontSize:10}} title={c.isStock?'TOP10 보유 상품 기준 (근사치)':undefined}>{c.yoyLabel || '전년비'} {c.yoy>=0?'▲':'▼'}{Math.abs(c.yoy)}%</div>}
          </div>
        ))}
      </div>

      {/* 공급 KPI Row — 전일/주간/누적 공급량 + 이동중 공급 */}
      <div className="ds-row" style={{marginBottom:16}}>
        {supplyKpiCards.map((c,i)=>(
          <div key={i} className={`ds-card ds-c${i+1}`}>
            <div className="ds-lbl" style={{fontSize:11}}>
              {c.label}
              {supplyLoading && supplyRaw.length === 0 && (
                <span style={{ fontSize:9, color:'#94a3b8', fontWeight:500, marginLeft:6 }}>· 로딩 중</span>
              )}
            </div>
            <div style={{fontSize:9,color:'var(--t3)',marginBottom:4}}>{c.sub}</div>
            <div className="ds-val" style={{color:c.color,fontSize:22}}>
              {supplyLoading && supplyRaw.length === 0
                ? <span style={{fontSize:13,color:'var(--t3)'}}>...</span>
                : fmt(c.qty)}
            </div>
            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',margin:'3px 0'}} title={VAT_LABEL}>
              {supplyLoading && supplyRaw.length === 0
                ? <span style={{color:'var(--t3)'}}>공급금액 집계중...</span>
                : (
                  <>공급금액 {c.rev > 0 ? fmt(c.rev) + '원' : '—'}</>
                )}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📈</div><div><div className="ch-title">3개년 판매 비교</div><div className="ch-sub">2024 · 2025 · 2026 일별 출고수량</div></div></div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <input type="date" value={chartFrom} onChange={e=>setChartFrom(e.target.value)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)'}}/>
            <span style={{fontSize:11,color:'var(--t3)'}}>~</span>
            <input type="date" value={chartTo} onChange={e=>setChartTo(e.target.value)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)'}}/>
          </div>
        </div>
        <div className="cb">
          {yoyChartData.length>0?(
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={yoyChartData} margin={{top:8,right:20,left:0,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="date" tick={{fontSize:10}} interval="preserveStartEnd"/>
                <YAxis tick={{fontSize:10}} width={40}/>
                <Tooltip formatter={(val:number,name:string)=>[fmt(val)+'개',name]} labelFormatter={l=>`날짜: ${l}`}/>
                <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11}}/>
                <Line type="monotone" dataKey="26년" stroke="#1D4ED8" strokeWidth={2.5} dot={false}/>
                <Line type="monotone" dataKey="25년" stroke="#7C3AED" strokeWidth={1.5} dot={false} strokeDasharray="5 3"/>
                <Line type="monotone" dataKey="24년" stroke="#065F46" strokeWidth={1.5} dot={false} strokeDasharray="2 2"/>
                {(() => {
                  const t = new Date()
                  const todayMD = `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`
                  const exists = yoyChartData.some(d => d.date === todayMD)
                  return exists ? <ReferenceLine x={todayMD} stroke="#f59e0b" strokeDasharray="4 3" label={{ value:'오늘', position:'top', fontSize:10, fill:'#f59e0b', fontWeight:700 }}/> : null
                })()}
              </LineChart>
            </ResponsiveContainer>
          ):<div className="empty-st" style={{height:300}}><div className="es-ico">📈</div><div className="es-t">데이터 로딩 중...</div></div>}
        </div>
      </div>

      {/* 일별 공급량 + 공급매출 차트 — 3개년 판매 비교 아래 */}
      {(() => {
        // 공급 차트는 supplyRaw 자체에서 기간 계산 (sales chartFrom/chartTo 의존성 제거)
        // 최근 30일: supplyKpis.latest (=오늘 이하 가장 최근 입고예정일) - 29일
        if (supplyRaw.length === 0) return null
        const supplyTo = supplyKpis.latest
        const supplyToDate = new Date(supplyTo + 'T00:00:00')
        const supplyFromDate = new Date(supplyToDate); supplyFromDate.setDate(supplyToDate.getDate() - 29)
        const supplyFrom = toYMD(supplyFromDate)
        const dailySupply: Record<string, { qty: number; amt: number }> = {}
        for (const r of supplyRaw) {
          const d = (r.입고예정일 || '').slice(0,10)
          if (d < supplyFrom || d > supplyTo) continue
          const q = Number(r.확정수량 || 0)
          const mp = Number(r.매입가 || 0)
          if (!dailySupply[d]) dailySupply[d] = { qty: 0, amt: 0 }
          dailySupply[d].qty += q
          dailySupply[d].amt += q * mp
        }
        const supplyChart = Object.entries(dailySupply).sort(([a],[b])=>a.localeCompare(b))
          .map(([d, v]) => ({ date: d.slice(5), 공급량: v.qty, 공급매출: Math.round(v.amt) }))
        if (supplyChart.length === 0) return null
        const todayMD = (() => { const t=new Date(); return `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}` })()
        return (
          <div className="card" style={{marginBottom:12}}>
            <div className="ch">
              <div className="ch-l"><div className="ch-ico">🚚</div><div>
                <div className="ch-title">일별 공급량 · 공급매출</div>
                <div className="ch-sub">{supplyFrom} ~ {supplyTo} · 입고예정일 기준 확정 (VAT 별도)</div>
              </div></div>
            </div>
            <div className="cb">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={supplyChart} margin={{top:8,right:20,left:0,bottom:5}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                  <XAxis dataKey="date" tick={{fontSize:10}} interval="preserveStartEnd"/>
                  <YAxis yAxisId="left" tick={{fontSize:10}} width={45}/>
                  <YAxis yAxisId="right" orientation="right" tick={{fontSize:10}} width={56}
                    tickFormatter={(v:number)=> v>=100_000_000?`${(v/100_000_000).toFixed(1)}억`:v>=10_000?`${Math.round(v/10_000)}만`:String(v)}/>
                  <Tooltip
                    formatter={(val:number, name:string) => name==='공급매출' ? [fmt(val)+'원', name] : [fmt(val)+'개', name]}
                    labelFormatter={l=>`날짜: ${l}`}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11}}/>
                  <Bar yAxisId="left" dataKey="공급량" fill="#A855F7" radius={[3,3,0,0]}>
                    <LabelList dataKey="공급량" position="top" fontSize={9} fill="#7C3AED"
                      formatter={(v:number)=> v>0 ? fmt(v) : ''}/>
                  </Bar>
                  <Line yAxisId="right" type="monotone" dataKey="공급매출" stroke="#10B981" strokeWidth={2} dot={{r:2}}>
                    <LabelList dataKey="공급매출" position="top" fontSize={9} fill="#059669"
                      formatter={(v:number)=> {
                        if (!v || v<=0) return ''
                        if (v>=100_000_000) return `${(v/100_000_000).toFixed(1)}억`
                        if (v>=10_000_000) return `${Math.round(v/1_000_000)}백만`
                        if (v>=10_000) return `${Math.round(v/10_000)}만`
                        return String(v)
                      }}/>
                  </Line>
                  {supplyChart.some(d => d.date === todayMD) && (
                    <ReferenceLine yAxisId="left" x={todayMD} stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1.5} label={{value:'오늘',position:'top',fontSize:10,fill:'#dc2626',fontWeight:700}}/>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })()}

      <div className="g2" style={{marginBottom:12}}>
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🥇</div><div>
              <div className="ch-title">판매 TOP 10</div>
              <div className="ch-sub">
                {topFrom === topTo ? `${topFrom}` : `${topFrom} ~ ${topTo}`} · 상품명 기준 바코드 합산
              </div>
            </div></div>
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              {([
                {k:'yesterday',label:'전일'},
                {k:'week',label:'주간'},
                {k:'month',label:'월간'},
                {k:'ytd',label:'누적'},
              ] as {k:TopPreset;label:string}[]).map(({k,label})=>{
                const on = topPreset === k
                return (
                  <button
                    key={k}
                    onClick={()=>setTopPreset(k)}
                    style={{
                      padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:600,
                      cursor:'pointer', border:'1px solid var(--border)',
                      background: on ? '#2563eb' : 'var(--bg)',
                      color: on ? 'white' : 'var(--t2)',
                    }}
                  >{label}</button>
                )
              })}
            </div>
          </div>
          <div className="cb" style={{padding:'4px 14px 10px'}}>
            {loadingTop?<div className="empty-st"><div className="es-ico">🥇</div><div className="es-t">로딩 중...</div></div>
            :topProducts.length>0?(
              <div className="tw" style={{overflowX:'auto'}}>
                <table style={{minWidth:520}}>
                  <thead><tr>
                    <th style={{width:28}}>#</th><th style={{width:36}}>이미지</th><th>상품명</th>
                    <th style={{textAlign:'right'}}>24년</th><th style={{textAlign:'right'}}>25년</th><th style={{textAlign:'right'}}>26년</th>
                    <th style={{textAlign:'right'}}>전년대비</th><th style={{textAlign:'right'}}>비중</th>
                  </tr></thead>
                  <tbody>
                    {topProducts.map((item,i)=>{
                      const yoy25=item.qty_25?pct(item.qty_26||0,item.qty_25):null
                      const share=totalSales26>0?Math.round((item.qty_26||0)/totalSales26*1000)/10:0
                      return(
                        <tr key={i}>
                          <td><span className={`rank-medal ${['rm1','rm2','rm3','rmn','rmn','rmn','rmn','rmn','rmn','rmn'][i]}`}>{i+1}</span></td>
                          <td>{item.image_url?<img src={item.image_url} alt="" style={{width:28,height:28,borderRadius:4,objectFit:'cover'}} onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>:<div style={{width:28,height:28,borderRadius:4,background:'var(--bg)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9}}>-</div>}</td>
                          <td>
                            <span
                              onClick={()=>setSalesModal(item.product_name)}
                              style={{fontWeight:700,maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block',cursor:'pointer',color:'var(--blue)',textDecoration:'underline dotted'}}
                              title="클릭 시 판매 추이"
                            >{item.product_name}</span>
                          </td>
                          <td style={{textAlign:'right',color:'var(--t3)',fontSize:11}}>{item.qty_24?fmt(item.qty_24):'-'}</td>
                          <td style={{textAlign:'right',color:'var(--t3)',fontSize:11}}>{item.qty_25?fmt(item.qty_25):'-'}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{fmt(item.qty_26||0)}</td>
                          <td style={{textAlign:'right'}}>{yoy25!==null?<span className={yoy25>=0?'diff-up':'diff-dn'} style={{fontSize:10}}>{yoy25>=0?'▲':'▼'}{Math.abs(yoy25)}%</span>:<span style={{color:'var(--t3)',fontSize:10}}>-</span>}</td>
                          <td style={{textAlign:'right',fontSize:11,color:'var(--t2)'}}>{share}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ):<div className="empty-st"><div className="es-ico">🥇</div><div className="es-t">데이터 없음</div></div>}
          </div>
        </div>

        <div className="card">
          <div className="ch"><div className="ch-l"><div className="ch-ico">📦</div><div><div className="ch-title">재고 TOP 10</div><div className="ch-sub">상품명 기준 바코드 합산</div></div></div></div>
          <div className="cb" style={{padding:'4px 14px 10px'}}>
            {topStock.length>0?(
              <div className="tw" style={{overflowX:'auto'}}>
                <table style={{minWidth:480}}>
                  <thead><tr>
                    <th style={{width:28}}>#</th><th style={{width:36}}>이미지</th><th>상품명</th>
                    <th style={{textAlign:'right'}}>재고량</th><th style={{textAlign:'right'}}>재고액</th>
                    <th style={{textAlign:'right'}}>전주대비</th><th style={{textAlign:'right'}}>비중</th>
                  </tr></thead>
                  <tbody>
                    {topStock.map((p,i)=>{
                      const weekDiff=p.prev_week_stock!=null?p.total_stock-p.prev_week_stock!:null
                      const share=totalStock>0?Math.round(p.total_stock/totalStock*1000)/10:0
                      return(
                        <tr key={i}>
                          <td style={{fontSize:11,color:'var(--t3)'}}>{i+1}</td>
                          <td>{p.image_url?<img src={p.image_url} alt="" style={{width:28,height:28,borderRadius:4,objectFit:'cover'}} onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>:<div style={{width:28,height:28,borderRadius:4,background:'var(--bg)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9}}>-</div>}</td>
                          <td>
                            <span
                              onClick={async()=>{
                                const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_stock_history_by_name`,{
                                  method:'POST',
                                  headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json'},
                                  body:JSON.stringify({p_name:p.product_name,p_from:'2026-01-01'})
                                })
                                const data=await res.json()
                                // sale_date가 timestamp로 와도 안전하게 'YYYY-MM-DD'로 잘라 'MM-DD' 추출
                                const history=Array.isArray(data)?data.map((r:{sale_date:string;total_stock:number})=>({week:String(r.sale_date??'').slice(0,10).slice(5),qty:r.total_stock})):[]
                                setStockModal({name:p.product_name,history})
                              }}
                              style={{fontWeight:700,maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block',cursor:'pointer',color:'var(--blue)',textDecoration:'underline dotted'}}
                              title="클릭 시 재고 추이"
                            >{p.product_name}</span>
                          </td>
                          <td style={{textAlign:'right',fontWeight:800,color:'var(--green)'}}>{fmt(p.total_stock)}</td>
                          <td style={{textAlign:'right',fontWeight:800,color:'var(--blue)',fontSize:11}}>{fmt(p.stock_value)}</td>
                          <td style={{textAlign:'right'}}>{weekDiff!==null?<span className={weekDiff>=0?'diff-up':'diff-dn'} style={{fontSize:10}}>{weekDiff>=0?'▲':'▼'}{fmt(Math.abs(weekDiff))}</span>:<span style={{color:'var(--t3)',fontSize:10}}>-</span>}</td>
                          <td style={{textAlign:'right',fontSize:11,color:'var(--t2)'}}>{share}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ):<div className="empty-st"><div className="es-ico">📦</div><div className="es-t">로딩 중...</div></div>}
          </div>
        </div>
      </div>

      {salesModal&&<SalesTrendModal productName={salesModal} onClose={()=>setSalesModal(null)}/>}
      {stockModal&&<StockTrendModal productName={stockModal.name} stockHistory={stockModal.history} onClose={()=>setStockModal(null)}/>}
    </div>
  )
}

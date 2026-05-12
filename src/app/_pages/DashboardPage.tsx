'use client'
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '@/lib/store'
import { toYMD } from '@/lib/dateUtils'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

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
const RPC_CACHE_PREFIX = 'ca_rpc_'
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
    const lastThu=new Date(d); lastThu.setDate(d.getDate()-((dow+3)%7+1))
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
  const [loadingTop,setLoadingTop]=useState(false)
  const [salesModal,setSalesModal]=useState<string|null>(null)
  const [stockModal,setStockModal]=useState<{name:string;history:{week:string;qty:number}[]}|null>(null)

  // latestDate 로드 후 차트/TOP 기간 초기화 (30일 전 ~ latestDate)
  useEffect(()=>{
    if(!latestDate) return
    const d=new Date(latestDate); d.setDate(d.getDate()-30)
    const from30 = toYMD(d)
    setChartFrom(from30); setChartTo(latestDate)
    setTopFrom(from30); setTopTo(latestDate)
  },[latestDate])

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
      row ? { qty: Number(row.total_qty||0), rev: Number(row.total_revenue||0) } : null

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
  },[latestDate,weekRange.from,weekRange.to,cumRange.from,cumRange.to])

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
    ]
    const applyAll = (p26: TopProduct[], p25: TopProduct[], p24: TopProduct[], stocks: Stock[]) => {
      const map25=new Map<string,number>(); p25.forEach(r=>map25.set(r.product_name,r.total_qty))
      const map24=new Map<string,number>(); p24.forEach(r=>map24.set(r.product_name,r.total_qty))
      setTopProducts(p26.map(r=>({...r,qty_26:r.total_qty,qty_25:map25.get(r.product_name)||0,qty_24:map24.get(r.product_name)||0})))
      setTopStock(stocks)
    }

    // 1) 캐시가 있으면 즉시 표시
    const c26 = arrFromCache<TopProduct>(readRpcCache(calls[0][0], calls[0][1]))
    const c25 = arrFromCache<TopProduct>(readRpcCache(calls[1][0], calls[1][1]))
    const c24 = arrFromCache<TopProduct>(readRpcCache(calls[2][0], calls[2][1]))
    const cStk = arrFromCache<Stock>(readRpcCache(calls[3][0], calls[3][1]))
    if (c26.length > 0 || cStk.length > 0) {
      applyAll(c26, c25, c24, cStk)
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
      const [r26,r25,r24,rs] = results
      const p26 = arrFromSettled<TopProduct>(r26)
      const p25 = arrFromSettled<TopProduct>(r25)
      const p24 = arrFromSettled<TopProduct>(r24)
      const stocks = arrFromSettled<Stock>(rs)
      applyAll(p26, p25, p24, stocks)
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
  const pct=(now:number,prev:number)=>prev?Math.round((now-prev)/prev*100):0
  const s=state.stockSummary
  const stockValueMaster  = (s as {stock_value_master?:number}).stock_value_master  ?? s.stock_value
  const stockValueCoupang = (s as {stock_value_coupang?:number}).stock_value_coupang ?? 0
  const [stockCostSrc, setStockCostSrc] = useState<'master'|'coupang'>('coupang')
  const displayedStockValue = stockCostSrc === 'master' ? stockValueMaster : (stockValueCoupang || stockValueMaster)

  const kpiCards:{label:string;sub:string;qty:number|null;rev:number|null;yoy:number|null;color:string;isStock:boolean}[]=[
    {label:'판매량',sub:`전일 (${latestDate})`,qty:kpiYest?.qty??null,rev:kpiYest?.rev??null,yoy:kpiYest&&kpiYest25?pct(kpiYest.qty,kpiYest25.qty):null,color:'var(--blue)',isStock:false},
    {label:'주간 판매량',sub:`${weekRange.from.slice(5)} ~ ${weekRange.to.slice(5)} (금~목)`,qty:kpiWeek?.qty??null,rev:kpiWeek?.rev??null,yoy:kpiWeek&&kpiWeek25?pct(kpiWeek.qty,kpiWeek25.qty):null,color:'var(--purple)',isStock:false},
    {label:'누적 판매량',sub:`${cumRange.from.slice(5)} ~ ${latestDate.slice(5)} (26년)`,qty:kpiCum?.qty??null,rev:kpiCum?.rev??null,yoy:kpiCum&&kpiCum25?pct(kpiCum.qty,kpiCum25.qty):null,color:'var(--green)',isStock:false},
    {label:'전일 재고',sub:`쿠팡 재고 (${latestDate})`,qty:s.total_stock||null,rev:displayedStockValue||null,yoy:null,color:'var(--amber)',isStock:true},
  ]

  return (
    <div>
      <div className="ds-row" style={{marginBottom:16}}>
        {kpiCards.map((c,i)=>(
          <div key={i} className={`ds-card ds-c${i+1}`}>
            <div className="ds-lbl" style={{fontSize:11}}>{c.label}</div>
            <div style={{fontSize:9,color:'var(--t3)',marginBottom:4}}>{c.sub}</div>
            <div className="ds-val" style={{color:c.color,fontSize:22}}>{c.qty===null?<span style={{fontSize:13,color:'var(--t3)'}}>로딩...</span>:fmt(c.qty)}</div>
            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',margin:'3px 0'}}>
              {c.isStock?`재고액 ${c.rev!==null?Math.round((c.rev||0)/100000000*10)/10+'억':'—'}`:`매출 ${c.rev!==null?fmt(c.rev||0)+'원':'—'}`}
            </div>
            {c.isStock && (
              <div style={{display:'flex',gap:3,marginTop:4}}>
                <button onClick={()=>setStockCostSrc('master')}
                  style={{fontSize:9,padding:'2px 6px',borderRadius:4,cursor:'pointer',fontWeight:700,border:'1px solid var(--border)',
                    background:stockCostSrc==='master'?'var(--amber)':'var(--bg)',color:stockCostSrc==='master'?'#fff':'var(--t3)'}}
                  title="상품마스터(이지어드민) 원가 기준">마스터</button>
                <button onClick={()=>setStockCostSrc('coupang')}
                  style={{fontSize:9,padding:'2px 6px',borderRadius:4,cursor:'pointer',fontWeight:700,border:'1px solid var(--border)',
                    background:stockCostSrc==='coupang'?'var(--amber)':'var(--bg)',color:stockCostSrc==='coupang'?'#fff':'var(--t3)'}}
                  title="쿠팡 허브 매입가 기준">쿠팡</button>
              </div>
            )}
            {c.yoy!==null&&<div className={c.yoy>=0?'diff-up':'diff-dn'} style={{fontSize:10}}>전년비 {c.yoy>=0?'▲':'▼'}{Math.abs(c.yoy)}%</div>}
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
              </LineChart>
            </ResponsiveContainer>
          ):<div className="empty-st" style={{height:300}}><div className="es-ico">📈</div><div className="es-t">데이터 로딩 중...</div></div>}
        </div>
      </div>

      <div className="g2" style={{marginBottom:12}}>
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🥇</div><div><div className="ch-title">판매 TOP 10</div><div className="ch-sub">상품명 기준 바코드 합산</div></div></div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <input type="date" value={topFrom} onChange={e=>setTopFrom(e.target.value)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)'}}/>
              <span style={{fontSize:11,color:'var(--t3)'}}>~</span>
              <input type="date" value={topTo} onChange={e=>setTopTo(e.target.value)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)'}}/>
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

      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📣</div><div><div className="ch-title">광고 요약</div></div></div>
          <button onClick={()=>{const nav=(window as Record<string,unknown>).navigateTo as ((p:string)=>void);nav?.('/ad')}} className="btn-g" style={{fontSize:11,padding:'5px 10px',cursor:'pointer',border:'none'}}>상세 →</button>
        </div>
        <div className="cb">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8}}>
            {[{label:'ROAS',value:'—',color:'var(--green)',note:'목표 3.5 이상'},{label:'ACoS',value:'—',color:'var(--blue)',note:'목표 25% 이하'},{label:'광고비',value:'0',color:'var(--text)',note:'기간 집행'},{label:'광고매출',value:'0',color:'var(--text)',note:'기간 기여'}].map(item=>(
              <div key={item.label} style={{background:'var(--bg)',borderRadius:'var(--r10)',padding:11,border:'1px solid var(--border)'}}>
                <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',marginBottom:4}}>{item.label}</div>
                <div style={{fontSize:18,fontWeight:800,color:item.color}}>{item.value}</div>
                <div style={{fontSize:10,fontWeight:600,color:'var(--t3)',marginTop:3}}>{item.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {salesModal&&<SalesTrendModal productName={salesModal} onClose={()=>setSalesModal(null)}/>}
      {stockModal&&<StockTrendModal productName={stockModal.name} stockHistory={stockModal.history} onClose={()=>setStockModal(null)}/>}
    </div>
  )
}

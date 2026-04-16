'use client'
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '@/lib/store'
import { toYMD } from '@/lib/dateUtils'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid
} from 'recharts'

const SUPABASE_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function rpc(fn: string, params: Record<string,unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (data?.code) { console.warn('[RPC]', fn, data.message); return [] }
  return data
}

// ── 판매 추이 모달 ──
function SalesTrendModal({
  productName, onClose
}: { productName: string; onClose: () => void }) {
  const { state } = useApp()
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  const trendData = useMemo(() => {
    const map26 = new Map<string, number>()
    const map25 = new Map<string, number>()
    const map24 = new Map<string, number>()

    // 최근 60일
    const end = new Date()
    const start = new Date(); start.setDate(start.getDate() - 59)
    const from26 = toYMD(start), to26 = toYMD(end)
    const from25 = from26.replace('2026','2025'), to25 = to26.replace('2026','2025')
    const from24 = from26.replace('2026','2024'), to24 = to26.replace('2026','2024')

    state.daily26.filter(r => r.date >= from26 && r.date <= to26).forEach(r => map26.set(r.date, r.qty))
    state.daily25.filter(r => r.date >= from25 && r.date <= to25).forEach(r => map25.set(r.date.replace('2025','2026'), r.qty))
    state.daily24.filter(r => r.date >= from24 && r.date <= to24).forEach(r => map24.set(r.date.replace('2024','2026'), r.qty))

    const dates: string[] = []
    const cur = new Date(start)
    while (cur <= end) { dates.push(toYMD(cur)); cur.setDate(cur.getDate()+1) }
    return dates.map(d => ({
      date: d.slice(5),
      '26년': map26.get(d) || 0,
      '25년': map25.get(d) || 0,
      '24년': map24.get(d) || 0,
    })).filter(d => d['26년'] || d['25년'] || d['24년'])
  }, [state.daily26, state.daily25, state.daily24])

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.55)',
      zIndex:999, display:'flex', alignItems:'center', justifyContent:'center'
    }} onClick={onClose}>
      <div style={{
        background:'var(--card)', borderRadius:'var(--r12)', padding:24,
        width:'min(720px, 95vw)', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:15 }}>📈 판매 추이</div>
            <div style={{ fontSize:12, color:'var(--t3)', marginTop:2 }}>{productName}</div>
          </div>
          <button onClick={onClose} style={{
            background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8,
            padding:'6px 12px', cursor:'pointer', fontSize:12, color:'var(--t2)'
          }}>✕ 닫기</button>
        </div>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top:4, right:16, left:0, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize:9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize:9 }} width={36} />
              <Tooltip formatter={(val: number, name: string) => [fmt(val)+'개', name]} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize:10 }} />
             <Line type="monotone" dataKey="26년" stroke="#2563EB" strokeWidth={2.5} dot={false} />
<Line type="monotone" dataKey="25년" stroke="#9333EA" strokeWidth={2} dot={false} />
<Line type="monotone" dataKey="24년" stroke="#059669" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign:'center', padding:40, color:'var(--t3)' }}>데이터 없음</div>
        )}
      </div>
    </div>
  )
}

// ── 재고 추이 모달 ──
function StockTrendModal({
  productName, stockHistory, onClose
}: { productName: string; stockHistory: {week:string; qty:number}[]; onClose: () => void }) {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.55)',
      zIndex:999, display:'flex', alignItems:'center', justifyContent:'center'
    }} onClick={onClose}>
      <div style={{
        background:'var(--card)', borderRadius:'var(--r12)', padding:24,
        width:'min(600px, 95vw)', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:15 }}>📦 재고 추이</div>
            <div style={{ fontSize:12, color:'var(--t3)', marginTop:2 }}>{productName}</div>
          </div>
          <button onClick={onClose} style={{
            background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8,
            padding:'6px 12px', cursor:'pointer', fontSize:12, color:'var(--t2)'
          }}>✕ 닫기</button>
        </div>
        {stockHistory.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stockHistory} margin={{ top:4, right:16, left:0, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="week" tick={{ fontSize:9 }} />
              <YAxis tick={{ fontSize:9 }} width={40} />
              <Tooltip formatter={(val: number) => [fmt(val)+'개', '재고']} />
              <Bar dataKey="qty" fill="#3B82F6" radius={[4,4,0,0]} name="재고량" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign:'center', padding:40, color:'var(--t3)' }}>주간 재고 데이터 없음</div>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { state } = useApp()
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  const latestDate = state.latestSaleDate || toYMD(new Date(Date.now() - 86400000))

  const weekRange = useMemo(() => {
    const d = new Date(latestDate)
    const dow = d.getDay()
    const lastThu = new Date(d); lastThu.setDate(d.getDate() - ((dow + 3) % 7 + 1))
    const lastFri = new Date(lastThu); lastFri.setDate(lastThu.getDate() - 6)
    return { from: toYMD(lastFri), to: toYMD(lastThu) }
  }, [latestDate])

  const cumRange = { from: '2026-01-01', to: latestDate }

  // ── KPI 상태 ──
  const [kpiYest, setKpiYest] = useState<{qty:number,rev:number}|null>(null)
  const [kpiWeek, setKpiWeek] = useState<{qty:number,rev:number}|null>(null)
  const [kpiCum, setKpiCum] = useState<{qty:number,rev:number}|null>(null)
  const [kpiYest25, setKpiYest25] = useState<{qty:number,rev:number}|null>(null)
  const [kpiWeek25, setKpiWeek25] = useState<{qty:number,rev:number}|null>(null)
  const [kpiCum25, setKpiCum25] = useState<{qty:number,rev:number}|null>(null)

  // ── 차트 날짜 ──
  const [chartFrom, setChartFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return toYMD(d)
  })
  const [chartTo, setChartTo] = useState(latestDate || toYMD(new Date()))

  // ── TOP10 날짜 ──
  const [topFrom, setTopFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return toYMD(d)
  })
  const [topTo, setTopTo] = useState(latestDate || toYMD(new Date()))

  // ── TOP10 데이터 (연도별 분리) ──
  type TopProduct = {
    product_name: string
    image_url: string
    total_qty: number
    total_revenue: number
    qty_24?: number
    qty_25?: number
    qty_26?: number
  }
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [topStock, setTopStock] = useState<{
    product_name:string; image_url:string; total_stock:number; stock_value:number;
    prev_week_stock?:number
  }[]>([])
  const [loadingTop, setLoadingTop] = useState(false)

  // ── 모달 ──
  const [salesModal, setSalesModal] = useState<string|null>(null)
  const [stockModal, setStockModal] = useState<{name:string; history:{week:string;qty:number}[]}|null>(null)

  // ── latestDate 동기화 ──
  useEffect(() => {
    if (latestDate) { setChartTo(latestDate); setTopTo(latestDate) }
  }, [latestDate])

  // ── KPI 로드 ──
  useEffect(() => {
    if (!latestDate) return
    const d25 = latestDate.replace('2026','2025')
    const w25f = weekRange.from.replace('2026','2025')
    const w25t = weekRange.to.replace('2026','2025')
    const c25t = cumRange.to.replace('2026','2025')
    Promise.all([
      rpc('get_kpi_by_date', { target_date: latestDate }),
      rpc('get_kpi_range', { date_from: weekRange.from, date_to: weekRange.to }),
      rpc('get_kpi_range', { date_from: cumRange.from, date_to: cumRange.to }),
      rpc('get_kpi_by_date', { target_date: d25 }),
      rpc('get_kpi_range', { date_from: w25f, date_to: w25t }),
      rpc('get_kpi_range', { date_from: '2025-01-01', date_to: c25t }),
    ]).then(([y, w, c, y25, w25, c25]) => {
      setKpiYest( { qty: Number(y[0]?.total_qty||0), rev: Number(y[0]?.total_revenue||0) })
      setKpiWeek( { qty: Number(w[0]?.total_qty||0), rev: Number(w[0]?.total_revenue||0) })
      setKpiCum(  { qty: Number(c[0]?.total_qty||0), rev: Number(c[0]?.total_revenue||0) })
      setKpiYest25({ qty: Number(y25[0]?.total_qty||0), rev: Number(y25[0]?.total_revenue||0) })
      setKpiWeek25({ qty: Number(w25[0]?.total_qty||0), rev: Number(w25[0]?.total_revenue||0) })
      setKpiCum25( { qty: Number(c25[0]?.total_qty||0), rev: Number(c25[0]?.total_revenue||0) })
    })
  }, [latestDate, weekRange.from, weekRange.to])

  // ── TOP10 로드 (연도별 3개) ──
  useEffect(() => {
    if (!topFrom || !topTo) return
    setLoadingTop(true)

    const from24 = topFrom.replace('2026','2024'), to24 = topTo.replace('2026','2024')
    const from25 = topFrom.replace('2026','2025'), to25 = topTo.replace('2026','2025')

    Promise.all([
      rpc('get_top_products', { date_from: topFrom,  date_to: topTo,  top_n: 10 }),
      rpc('get_top_products', { date_from: from25,   date_to: to25,   top_n: 30 }),
      rpc('get_top_products', { date_from: from24,   date_to: to24,   top_n: 30 }),
      rpc('get_top_stock', { top_n: 10 }),
      rpc('get_top_stock', { top_n: 10 }),
    ]).then(([p26, p25, p24, stocks]) => {
      const map25 = new Map<string,number>(); (p25||[]).forEach((r: TopProduct) => map25.set(r.product_name, r.total_qty))
      const map24 = new Map<string,number>(); (p24||[]).forEach((r: TopProduct) => map24.set(r.product_name, r.total_qty))
      const merged = (p26||[]).map((r: TopProduct) => ({
        ...r,
        qty_26: r.total_qty,
        qty_25: map25.get(r.product_name) || 0,
        qty_24: map24.get(r.product_name) || 0,
      }))
      setTopProducts(merged)
      setTopStock(stocks || [])
      setLoadingTop(false)
    })
  }, [topFrom, topTo])

  // ── 3개년 차트 데이터 ──
  const yoyChartData = useMemo(() => {
    const map26 = new Map<string,number>()
    const map25 = new Map<string,number>()
    const map24 = new Map<string,number>()
    state.daily26.forEach(r => { if (r.date >= chartFrom && r.date <= chartTo) map26.set(r.date, r.qty) })
    state.daily25.forEach(r => {
      const mapped = r.date.replace('2025','2026')
      const d25 = chartFrom.replace('2026','2025'), d25e = chartTo.replace('2026','2025')
      if (r.date >= d25 && r.date <= d25e) map25.set(mapped, r.qty)
    })
    state.daily24.forEach(r => {
      const mapped = r.date.replace('2024','2026')
      const d24 = chartFrom.replace('2026','2024'), d24e = chartTo.replace('2026','2024')
      if (r.date >= d24 && r.date <= d24e) map24.set(mapped, r.qty)
    })
    const dates: string[] = []
    const cur = new Date(chartFrom), end = new Date(chartTo)
    while (cur <= end) { dates.push(toYMD(cur)); cur.setDate(cur.getDate()+1) }
    return dates.map(d => ({
      date: d.slice(5),
      '26년': map26.get(d) || 0,
      '25년': map25.get(d) || 0,
      '24년': map24.get(d) || 0,
    })).filter(d => d['26년'] || d['25년'] || d['24년'])
  }, [state.daily26, state.daily25, state.daily24, chartFrom, chartTo])

  // ── 공급 현황 차트 (ordersData 기반) ──
  const supplyChartData = useMemo(() => {
    const orders = state.ordersData as Record<string,unknown>[]
    if (!orders.length) return []

    const monthMap = new Map<string, { order: number; confirmed: number; received: number }>()

    orders.forEach(r => {
      const dateStr = String(r['order_date'] || '')
      if (!dateStr) return
      const month = dateStr.slice(0, 7)
      const cur = monthMap.get(month) || { order: 0, confirmed: 0, received: 0 }
      cur.order    += Number(r['order_qty']    || 0)
      cur.confirmed += Number(r['confirmed_qty'] || 0)
      cur.received  += Number(r['received_qty']  || 0)
      monthMap.set(month, cur)
    })

    return Array.from(monthMap.entries())
      .sort(([a],[b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, v]) => ({
        month: month.slice(2),
        발주수량: v.order,
        공급수량: v.confirmed,
        입고수량: v.received,
      }))
  }, [state.ordersData])

  const totalSales26 = useMemo(() => topProducts.reduce((s, r) => s + (r.qty_26 || 0), 0), [topProducts])
  const totalStock = useMemo(() => topStock.reduce((s, r) => s + (r.total_stock || 0), 0), [topStock])
  const pct = (now: number, prev: number) => prev ? Math.round((now - prev) / prev * 100) : 0

  const s = state.stockSummary
 const kpiCards: { label:string; sub:string; qty:number|null; rev:number|null; yoy:number|null; color:string; isStock:boolean }[] = [
    { label: '판매량', sub: `전일 (${latestDate})`, qty: kpiYest?.qty ?? null, rev: kpiYest?.rev ?? null, yoy: kpiYest && kpiYest25 ? pct(kpiYest.qty, kpiYest25.qty) : null, color: 'var(--blue)', isStock: false },
    { label: '주간 판매량', sub: `${weekRange.from.slice(5)} ~ ${weekRange.to.slice(5)} (금~목)`, qty: kpiWeek?.qty ?? null, rev: kpiWeek?.rev ?? null, yoy: kpiWeek && kpiWeek25 ? pct(kpiWeek.qty, kpiWeek25.qty) : null, color: 'var(--purple)', isStock: false },
    { label: '누적 판매량', sub: `26년 (${cumRange.from.slice(5)} ~ ${latestDate.slice(5)})`, qty: kpiCum?.qty ?? null, rev: kpiCum?.rev ?? null, yoy: kpiCum && kpiCum25 ? pct(kpiCum.qty, kpiCum25.qty) : null, color: 'var(--green)', isStock: false },
    { label: '전일 재고', sub: `쿠팡 재고 (${latestDate})`, qty: s.total_stock || null, rev: s.stock_value || null, yoy: null, color: 'var(--amber)', isStock: true },
  ]

  return (
    <div>
      {/* ── KPI 4종 ── */}
      <div className="ds-row" style={{ marginBottom: 16 }}>
        {kpiCards.map((c, i) => (
          <div key={i} className={`ds-card ds-c${i+1}`}>
            <div className="ds-lbl" style={{ fontSize: 11 }}>{c.label}</div>
            <div style={{ fontSize: 9, color: 'var(--t3)', marginBottom: 4 }}>{c.sub}</div>
            <div className="ds-val" style={{ color: c.color, fontSize: 22 }}>
              {c.qty === null ? <span style={{ fontSize: 13, color: 'var(--t3)' }}>로딩...</span> : fmt(c.qty)}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', margin: '3px 0' }}>
              {c.isStock
                ? `재고액 ${c.rev !== null ? Math.round((c.rev||0)/100000000*10)/10+'억' : '—'}`
                : `매출 ${c.rev !== null ? fmt(c.rev||0)+'원' : '—'}`}
            </div>
            {c.yoy !== null && (
              <div className={c.yoy >= 0 ? 'diff-up' : 'diff-dn'} style={{ fontSize: 10 }}>
                전년비 {c.yoy >= 0 ? '▲' : '▼'}{Math.abs(c.yoy)}%
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── 3개년 판매 비교 차트 ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l">
            <div className="ch-ico">📈</div>
            <div>
              <div className="ch-title">3개년 판매 비교</div>
              <div className="ch-sub">2024 · 2025 · 2026 일별 출고수량</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="date" value={chartFrom} onChange={e => setChartFrom(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
            <span style={{ fontSize:11, color:'var(--t3)' }}>~</span>
            <input type="date" value={chartTo} onChange={e => setChartTo(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
          </div>
        </div>
        <div className="cb">
          {yoyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={yoyChartData} margin={{ top:8, right:20, left:0, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize:10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize:10 }} width={40} />
                <Tooltip formatter={(val: number, name: string) => [fmt(val)+'개', name]} labelFormatter={(l) => `날짜: ${l}`} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:11 }} />
               <Line type="monotone" dataKey="26년" stroke="#1D4ED8" strokeWidth={2.5} dot={false} />
<Line type="monotone" dataKey="25년" stroke="#7C3AED" strokeWidth={2} dot={false} />
<Line type="monotone" dataKey="24년" stroke="#065F46" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-st" style={{ height:300 }}>
              <div className="es-ico">📈</div>
              <div className="es-t">데이터 로딩 중...</div>
            </div>
          )}
        </div>
      </div>

      {/* ── 공급 현황 그래프 ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l">
            <div className="ch-ico">🚚</div>
            <div>
              <div className="ch-title">공급 현황</div>
              <div className="ch-sub">월별 발주수량 · 공급수량 · 입고수량</div>
            </div>
          </div>
        </div>
        <div className="cb">
          {supplyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={supplyChartData} margin={{ top:8, right:20, left:0, bottom:5 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize:10 }} />
                <YAxis tick={{ fontSize:10 }} width={40} />
                <Tooltip formatter={(val: number, name: string) => [fmt(val)+'개', name]} labelFormatter={(l) => `기간: ${l}`} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:11 }} />
                <Bar dataKey="발주수량" fill="#3B82F6" radius={[4,4,0,0]} />
                <Bar dataKey="공급수량" fill="#A855F7" radius={[4,4,0,0]} />
                <Bar dataKey="입고수량" fill="#10B981" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-st" style={{ height:260 }}>
              <div className="es-ico">🚚</div>
              <div className="es-t">발주/공급/입고 데이터 로딩 중...</div>
            </div>
          )}
        </div>
      </div>

      {/* ── 판매 TOP10 + 재고 TOP10 ── */}
      <div className="g2" style={{ marginBottom: 12 }}>

        {/* 판매 TOP 10 */}
        <div className="card">
          <div className="ch">
            <div className="ch-l">
              <div className="ch-ico">🥇</div>
              <div>
                <div className="ch-title">판매 TOP 10</div>
                <div className="ch-sub">상품명 기준 바코드 합산</div>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <input type="date" value={topFrom} onChange={e => setTopFrom(e.target.value)}
                style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
              <span style={{ fontSize:11, color:'var(--t3)' }}>~</span>
              <input type="date" value={topTo} onChange={e => setTopTo(e.target.value)}
                style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
            </div>
          </div>
          <div className="cb" style={{ padding:'4px 14px 10px' }}>
            {loadingTop ? (
              <div className="empty-st"><div className="es-ico">🥇</div><div className="es-t">로딩 중...</div></div>
            ) : topProducts.length > 0 ? (
              <div className="tw" style={{ overflowX:'auto' }}>
                <table style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ width:28 }}>#</th>
                      <th style={{ width:36 }}>이미지</th>
                      <th>상품명</th>
                      <th style={{ textAlign:'right' }}>24년</th>
                      <th style={{ textAlign:'right' }}>25년</th>
                      <th style={{ textAlign:'right' }}>26년</th>
                      <th style={{ textAlign:'right' }}>전년대비</th>
                      <th style={{ textAlign:'right' }}>비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((item, i) => {
                      const yoy25 = item.qty_25 ? pct(item.qty_26||0, item.qty_25) : null
                      const share = totalSales26 > 0 ? Math.round((item.qty_26||0) / totalSales26 * 1000) / 10 : 0
                      return (
                        <tr key={i}>
                          <td><span className={`rank-medal ${['rm1','rm2','rm3','rmn','rmn','rmn','rmn','rmn','rmn','rmn'][i]}`}>{i+1}</span></td>
                          <td style={{ width:36 }}>
                            {item.image_url
                              ? <img src={item.image_url} alt="" style={{ width:28, height:28, borderRadius:4, objectFit:'cover' }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                              : <div style={{ width:28, height:28, borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9 }}>-</div>
                            }
                          </td>
                          <td>
                            <span
                              onClick={() => {
  const SURL = 'https://vzyfygmzqqiwgrcuydti.supabase.co';
  const SKEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI';
  fetch(`${SURL}/rest/v1/rpc/get_stock_history_by_name`, {
    method: 'POST',
    headers: { 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_name: p.product_name, p_from: '2026-01-01' })
  }).then(r => r.json()).then(data => {
    const history = Array.isArray(data) ? data.map((r: {sale_date:string; total_stock:number}) => ({ week: r.sale_date.slice(5), qty: r.total_stock })) : [];
    setStockModal({ name: p.product_name, history });
  });
}}
                         <span
  onClick={() => setSalesModal(item.product_name)}
  style={{ fontWeight:700, ...cursor:'pointer'... }}
  onClick={() => setSalesModal(item.product_name)}
                              title="클릭 시 판매 추이"
                            >{item.product_name}</span>
                          </td>
                          <td style={{ textAlign:'right', color:'var(--t3)', fontSize:11 }}>{item.qty_24 ? fmt(item.qty_24) : '-'}</td>
                          <td style={{ textAlign:'right', color:'var(--t3)', fontSize:11 }}>{item.qty_25 ? fmt(item.qty_25) : '-'}</td>
                          <td style={{ textAlign:'right', fontWeight:700 }}>{fmt(item.qty_26||0)}</td>
                          <td style={{ textAlign:'right' }}>
                            {yoy25 !== null
                              ? <span className={yoy25 >= 0 ? 'diff-up' : 'diff-dn'} style={{ fontSize:10 }}>{yoy25 >= 0 ? '▲' : '▼'}{Math.abs(yoy25)}%</span>
                              : <span style={{ color:'var(--t3)', fontSize:10 }}>-</span>}
                          </td>
                          <td style={{ textAlign:'right', fontSize:11, color:'var(--t2)' }}>{share}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-st"><div className="es-ico">🥇</div><div className="es-t">데이터 없음</div></div>
            )}
          </div>
        </div>

        {/* 재고 TOP 10 */}
        <div className="card">
          <div className="ch">
            <div className="ch-l">
              <div className="ch-ico">📦</div>
              <div>
                <div className="ch-title">재고 TOP 10</div>
                <div className="ch-sub">상품명 기준 바코드 합산</div>
              </div>
            </div>
          </div>
          <div className="cb" style={{ padding:'4px 14px 10px' }}>
            {topStock.length > 0 ? (
              <div className="tw" style={{ overflowX:'auto' }}>
                <table style={{ minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th style={{ width:28 }}>#</th>
                      <th style={{ width:36 }}>이미지</th>
                      <th>상품명</th>
                      <th style={{ textAlign:'right' }}>재고량</th>
                      <th style={{ textAlign:'right' }}>재고액</th>
                      <th style={{ textAlign:'right' }}>전주대비</th>
                      <th style={{ textAlign:'right' }}>비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topStock.map((p, i) => {
                      const prevStock = p.prev_week_stock ?? null
                      const weekDiff = prevStock !== null ? p.total_stock - prevStock : null
                      const share = totalStock > 0 ? Math.round(p.total_stock / totalStock * 1000) / 10 : 0
                      return (
                        <tr key={i}>
                          <td style={{ fontSize:11, color:'var(--t3)' }}>{i+1}</td>
                          <td style={{ width:36 }}>
                            {p.image_url
                              ? <img src={p.image_url} alt="" style={{ width:28, height:28, borderRadius:4, objectFit:'cover' }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                              : <div style={{ width:28, height:28, borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9 }}>-</div>
                            }
                          </td>
                          <td>
                            <span
                              onClick={async () => {
  const SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI';
  const res = await fetch('https://vzyfygmzqqiwgrcuydti.supabase.co/rest/v1/rpc/get_stock_history_by_name', {
    method: 'POST',
    headers: { 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_name: p.product_name, p_from: '2026-01-01' })
  });
  const data = await res.json();
  const history = Array.isArray(data) ? data.map((r: {sale_date:string; total_stock:number}) => ({ week: r.sale_date.slice(5), qty: r.total_stock })) : [];
  setStockModal({ name: p.product_name, history });
}}
                              style={{ fontWeight:700, maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block', cursor:'pointer', color:'var(--blue)', textDecoration:'underline dotted' }}
                              title="클릭 시 재고 추이"
                            >{p.product_name}</span>
                          </td>
                          <td style={{ textAlign:'right', fontWeight:800, color:'var(--green)' }}>{fmt(p.total_stock)}</td>
                          <td style={{ textAlign:'right', fontWeight:800, color:'var(--blue)', fontSize:11 }}>{fmt(p.stock_value)}</td>
                          <td style={{ textAlign:'right' }}>
                            {weekDiff !== null
                              ? <span className={weekDiff >= 0 ? 'diff-up' : 'diff-dn'} style={{ fontSize:10 }}>{weekDiff >= 0 ? '▲' : '▼'}{fmt(Math.abs(weekDiff))}</span>
                              : <span style={{ color:'var(--t3)', fontSize:10 }}>-</span>}
                          </td>
                          <td style={{ textAlign:'right', fontSize:11, color:'var(--t2)' }}>{share}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-st"><div className="es-ico">📦</div><div className="es-t">로딩 중...</div></div>
            )}
          </div>
        </div>
      </div>

      {/* ── 광고 요약 ── */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📣</div><div><div className="ch-title">광고 요약</div></div></div>
          <button
            onClick={() => { const nav = (window as Record<string,unknown>).navigateTo as ((p:string)=>void); nav?.('/ad') }}
            className="btn-g" style={{ fontSize:11, padding:'5px 10px', cursor:'pointer', border:'none' }}
          >상세 →</button>
        </div>
        <div className="cb">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8 }}>
            {[
              { label:'ROAS', value:'—', color:'var(--green)', note:'목표 3.5 이상' },
              { label:'ACoS', value:'—', color:'var(--blue)', note:'목표 25% 이하' },
              { label:'광고비', value:'0', color:'var(--text)', note:'기간 집행' },
              { label:'광고매출', value:'0', color:'var(--text)', note:'기간 기여' },
            ].map(item => (
              <div key={item.label} style={{ background:'var(--bg)', borderRadius:'var(--r10)', padding:11, border:'1px solid var(--border)' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--t3)', marginBottom:4 }}>{item.label}</div>
                <div style={{ fontSize:18, fontWeight:800, color:item.color }}>{item.value}</div>
                <div style={{ fontSize:10, fontWeight:600, color:'var(--t3)', marginTop:3 }}>{item.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 모달 ── */}
      {salesModal && <SalesTrendModal productName={salesModal} onClose={() => setSalesModal(null)} />}
      {stockModal && <StockTrendModal productName={stockModal.name} stockHistory={stockModal.history} onClose={() => setStockModal(null)} />}
    </div>
  )
}

'use client'

import { useState, useMemo } from 'react'
import { useApp } from '@/lib/store'
import { filterByRange, getPresetRange, toYMD } from '@/lib/dateUtils'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

// ── 날짜 필터 컴포넌트 (각 페이지별 독립) ──
function DateFilter({ dateRange, onChange }: {
  dateRange: { from: Date; to: Date; label: string; preset: string }
  onChange: (dr: { from: Date; to: Date; label: string; preset: string }) => void
}) {
  const today = new Date(); today.setHours(0,0,0,0)
  const presets = [
    { key: 'today',     label: '오늘' },
    { key: 'yesterday', label: '전일' },
    { key: 'week',      label: '전주(금~목)' },
    { key: 'month',     label: '이번달' },
    { key: 'last30',    label: '최근30일' },
    { key: 'total',     label: '전체' },
  ]
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:12 }}>
      {presets.map(p => (
        <button key={p.key}
          onClick={() => onChange(getPresetRange(p.key, today))}
          style={{
            padding:'4px 10px', fontSize:11, fontWeight:700, borderRadius:6, cursor:'pointer', border:'none',
            background: dateRange.preset === p.key ? 'var(--blue)' : 'var(--bg)',
            color:      dateRange.preset === p.key ? '#fff'        : 'var(--t2)',
            border:     dateRange.preset === p.key ? 'none'        : '1px solid var(--border)',
          } as React.CSSProperties}
        >{p.label}</button>
      ))}
      <input type="date" value={toYMD(dateRange.from)}
        onChange={e => { const d = new Date(e.target.value); d.setHours(0,0,0,0); onChange({ ...dateRange, from: d, label: '직접입력', preset:'custom' }) }}
        style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }}
      />
      <span style={{ fontSize:11, color:'var(--t3)' }}>~</span>
      <input type="date" value={toYMD(dateRange.to)}
        onChange={e => { const d = new Date(e.target.value); d.setHours(0,0,0,0); onChange({ ...dateRange, to: d, label: '직접입력', preset:'custom' }) }}
        style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }}
      />
      <span style={{ fontSize:10, color:'var(--t3)', marginLeft:4 }}>{dateRange.label}</span>
    </div>
  )
}

export default function DashboardPage() {
  const { state } = useApp()
  const today = new Date(); today.setHours(0,0,0,0)

  // 각 섹션별 독립 날짜 필터
  const [kpiRange,     setKpiRange]     = useState(getPresetRange('yesterday', today))
  const [chartRange,   setChartRange]   = useState(getPresetRange('last30', today))
  const [topRange,     setTopRange]     = useState(getPresetRange('last30', today))
  const [stockRange,   setStockRange]   = useState(getPresetRange('last30', today))

  const fmt  = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const fmtW = (n: number) => n >= 10000 ? (n/10000).toFixed(1)+'만' : fmt(n)

  // ── KPI 계산 ──
  const kpiSales = useMemo(() => filterByRange(state.salesData.filter(r=>!r.isReturn), kpiRange), [state.salesData, kpiRange])
  const kpiQty   = kpiSales.reduce((s,r)=>s+r.qty, 0)
  const kpiRev   = kpiSales.reduce((s,r)=>s+r.revenue, 0)

  // 전년 동기 (KPI)
  const yoyFrom24 = new Date(kpiRange.from); yoyFrom24.setFullYear(2024)
  const yoyTo24   = new Date(kpiRange.to);   yoyTo24.setFullYear(2024)
  const yoyFrom25 = new Date(kpiRange.from); yoyFrom25.setFullYear(2025)
  const yoyTo25   = new Date(kpiRange.to);   yoyTo25.setFullYear(2025)
  const sales24   = filterByRange(state.salesData24, { from:yoyFrom24, to:yoyTo24, label:'', preset:'' })
  const sales25   = filterByRange(state.salesData25, { from:yoyFrom25, to:yoyTo25, label:'', preset:'' })
  const qty24     = sales24.reduce((s,r)=>s+r.qty, 0)
  const qty25     = sales25.reduce((s,r)=>s+r.qty, 0)
  const rev24     = sales24.reduce((s,r)=>s+r.revenue, 0)
  const rev25     = sales25.reduce((s,r)=>s+r.revenue, 0)
  const yoyQtyPct = qty25 ? Math.round((kpiQty - qty25) / qty25 * 100) : 0
  const yoyRevPct = rev25 ? Math.round((kpiRev - rev25) / rev25 * 100) : 0

  // 주간 (금~목)
  const weekSales = useMemo(() => filterByRange(state.salesData.filter(r=>!r.isReturn), getPresetRange('week', today)), [state.salesData])
  const weekQty   = weekSales.reduce((s,r)=>s+r.qty, 0)
  const weekRev   = weekSales.reduce((s,r)=>s+r.revenue, 0)
  const week25From = new Date(getPresetRange('week', today).from); week25From.setFullYear(2025)
  const week25To   = new Date(getPresetRange('week', today).to);   week25To.setFullYear(2025)
  const weekSales25 = filterByRange(state.salesData25, { from:week25From, to:week25To, label:'', preset:'' })
  const weekQty25  = weekSales25.reduce((s,r)=>s+r.qty, 0)
  const weekQtyPct = weekQty25 ? Math.round((weekQty - weekQty25) / weekQty25 * 100) : 0

  // 누적 26년
  const cumSales = useMemo(() => state.salesData.filter(r=>!r.isReturn && r.date >= '2026-01-01'), [state.salesData])
  const cumQty   = cumSales.reduce((s,r)=>s+r.qty, 0)
  const cumRev   = cumSales.reduce((s,r)=>s+r.revenue, 0)
  const cumSales25 = state.salesData25.filter(r=>!r.isReturn && r.date >= '2025-01-01')
  const cumQty25   = cumSales25.reduce((s,r)=>s+r.qty, 0)
  const cumQtyPct  = cumQty25 ? Math.round((cumQty - cumQty25) / cumQty25 * 100) : 0

  // 전일 재고 (products 기반)
  const totalStock = state.products.reduce((s,p)=>s+(p.fcStock+p.vfStock+p.hqStock), 0)
  const dangerStock = state.products.filter(p => (p.fcStock+p.vfStock) <= p.safetyStock && p.safetyStock > 0).length

  // ── 3개년 비교 차트 ──
  const yoyChartData = useMemo(() => {
    const filtered26 = filterByRange(state.salesData.filter(r=>!r.isReturn), chartRange)
    const from26 = chartRange.from; const to26 = chartRange.to

    // 날짜별 qty 맵
    const map26 = new Map<string, number>()
    const map25 = new Map<string, number>()
    const map24 = new Map<string, number>()

    filtered26.forEach(r => map26.set(r.date, (map26.get(r.date)||0) + r.qty))

    const from25 = new Date(from26); from25.setFullYear(2025)
    const to25   = new Date(to26);   to25.setFullYear(2025)
    filterByRange(state.salesData25, { from:from25, to:to25, label:'', preset:'' })
      .forEach(r => { const d = r.date.replace('2025','2026'); map25.set(d, (map25.get(d)||0) + r.qty) })

    const from24 = new Date(from26); from24.setFullYear(2024)
    const to24   = new Date(to26);   to24.setFullYear(2024)
    filterByRange(state.salesData24, { from:from24, to:to24, label:'', preset:'' })
      .forEach(r => { const d = r.date.replace('2024','2026'); map24.set(d, (map24.get(d)||0) + r.qty) })

    // 날짜 목록 생성 (chartRange 기간)
    const dates: string[] = []
    const cur = new Date(from26)
    while (cur <= to26) {
      dates.push(toYMD(cur))
      cur.setDate(cur.getDate() + 1)
    }

    return dates.map(d => ({
      date:  d.slice(5), // MM-DD
      '26년': map26.get(d) || 0,
      '25년': map25.get(d) || 0,
      '24년': map24.get(d) || 0,
    })).filter(d => d['26년'] || d['25년'] || d['24년'])
  }, [state.salesData, state.salesData25, state.salesData24, chartRange])

  // ── TOP 10 ──
  const topSales = useMemo(() => {
    const filtered = filterByRange(state.salesData.filter(r=>!r.isReturn), topRange)
    const map = new Map<string, { qty:number; rev:number; img:string; name:string }>()
    filtered.forEach(r => {
      const k = r.productName
      const existing = map.get(k)
      const prod = state.products.find(p => p.name === r.productName)
      const img  = prod?.imageUrl || ''
      if (existing) { existing.qty += r.qty; existing.rev += r.revenue }
      else map.set(k, { qty: r.qty, rev: r.revenue, img, name: r.productName })
    })
    return Array.from(map.values()).sort((a,b)=>b.qty - a.qty).slice(0, 10)
  }, [state.salesData, state.products, topRange])

  // ── 재고 TOP 10 ──
  const stockTop10 = useMemo(() =>
    [...state.products]
      .sort((a,b) => (b.fcStock+b.vfStock+b.hqStock) - (a.fcStock+a.vfStock+a.hqStock))
      .slice(0, 10)
  , [state.products])

  // ── 재고 소진 (products 기반) ──
  const [expandedStock, setExpandedStock] = useState<Set<string>>(new Set())
  const stockSales = useMemo(() => {
    const filtered = filterByRange(state.salesData.filter(r=>!r.isReturn), stockRange)
    const days = Math.max(1, Math.round((stockRange.to.getTime()-stockRange.from.getTime())/(1000*60*60*24))+1)
    const rateMap = new Map<string, number>()
    const nameMap = new Map<string, string>() // barcode → productName from sales
    filtered.forEach(r => {
      const prod = state.products.find(p=>p.name === r.productName)
      const key  = prod?.name || r.productName
      rateMap.set(key, (rateMap.get(key)||0) + r.qty)
      nameMap.set(key, r.productName)
    })
    // products를 상품명 기준으로 그룹핑
    const groupMap = new Map<string, typeof state.products>()
    state.products.forEach(p => {
      const arr = groupMap.get(p.name) || []
      arr.push(p)
      groupMap.set(p.name, arr)
    })
    return Array.from(groupMap.entries()).map(([name, prods]) => {
      const totalStock = prods.reduce((s,p)=>s+p.fcStock+p.vfStock, 0)
      const totalRate  = (rateMap.get(name) || 0.1) / days
      const daysLeft   = totalRate > 0 ? Math.round(totalStock / totalRate) : 999
      const status     = daysLeft < 7 ? 'danger' : daysLeft < 14 ? 'warn' : 'ok'
      const img        = prods[0]?.imageUrl || ''
      return { name, stock: totalStock, daysLeft, status, prods, img, rate: totalRate }
    })
    .filter(i => i.status !== 'ok' || i.stock > 0)
    .sort((a,b) => a.daysLeft - b.daysLeft)
    .slice(0, 10)
  }, [state.products, state.salesData, stockRange])

  // 광고
  const adEntries = filterByRange(state.adEntries, kpiRange)
  const adCost    = adEntries.reduce((s,a)=>s+a.adCost, 0)
  const adRev     = adEntries.reduce((s,a)=>s+a.adRevenue, 0)
  const roas      = adCost ? (adRev/adCost).toFixed(1) : '—'
  const acos      = adRev  ? (adCost/adRev*100).toFixed(1)+'%' : '—'

  const kpiCards = [
    {
      label: '판매량', sub: '(전일)', val: fmt(kpiQty), rev: fmt(kpiRev),
      yoy: yoyQtyPct, yoyRev: yoyRevPct, color: 'var(--blue)',
      note: `전년 동기 ${fmt(qty25)}개`
    },
    {
      label: '주간 판매량', sub: '(금~목)', val: fmt(weekQty), rev: fmt(weekRev),
      yoy: weekQtyPct, yoyRev: null, color: 'var(--purple)',
      note: `전년 ${fmt(weekQty25)}개`
    },
    {
      label: '누적 판매량', sub: '(26년)', val: fmt(cumQty), rev: fmt(cumRev),
      yoy: cumQtyPct, yoyRev: null, color: 'var(--green)',
      note: `전년 동기 ${fmt(cumQty25)}개`
    },
    {
      label: '전일 재고', sub: '', val: fmt(totalStock), rev: null,
      yoy: null, yoyRev: null, color: 'var(--amber)',
      note: `위험 ${dangerStock}품목`
    },
  ]

  return (
    <div>
      {/* ── KPI 4종 ── */}
      <div style={{ marginBottom:8 }}>
        <DateFilter dateRange={kpiRange} onChange={setKpiRange} />
      </div>
      <div className="ds-row" style={{ marginBottom:16 }}>
        {kpiCards.map((c, i) => (
          <div key={i} className={`ds-card ds-c${i+1}`}>
            <div className="ds-lbl">{c.label} <span style={{ fontSize:10, fontWeight:500, color:'var(--t3)' }}>{c.sub}</span></div>
            <div className="ds-val" style={{ color: c.color }}>{c.val}</div>
            {c.rev !== null && (
              <div style={{ fontSize:11, fontWeight:700, color:'var(--t2)', marginTop:2 }}>
                매출 {c.rev}원
              </div>
            )}
            <div className="ds-cmp">
              {c.yoy !== null && (
                <span className={c.yoy >= 0 ? 'diff-up' : 'diff-dn'}>
                  전년비 {c.yoy >= 0 ? '▲' : '▼'}{Math.abs(c.yoy)}%
                </span>
              )}
              <span className="ds-sub" style={{ marginLeft:6, fontSize:10 }}>{c.note}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 3개년 판매 추이 ── */}
      <div className="card" style={{ marginBottom:12 }}>
        <div className="ch">
          <div className="ch-l">
            <div className="ch-ico">📈</div>
            <div>
              <div className="ch-title">3개년 판매 비교</div>
              <div className="ch-sub">2024 · 2025 · 2026 일별 판매량</div>
            </div>
          </div>
        </div>
        <div style={{ padding:'4px 14px 8px' }}>
          <DateFilter dateRange={chartRange} onChange={setChartRange} />
        </div>
        <div className="cb">
          {yoyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={yoyChartData} margin={{ top:5, right:20, left:0, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize:10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize:10 }} width={35} />
                <Tooltip formatter={(val: number) => [fmt(val)+'개', '']} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:11 }} />
                <Line type="monotone" dataKey="26년" stroke="#3B82F6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="25년" stroke="#8B5CF6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="24년" stroke="#10B981" strokeWidth={1.5} dot={false} strokeDasharray="2 2" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-st"><div className="es-ico">📈</div><div className="es-t">판매 데이터 로딩 중...</div></div>
          )}
        </div>
      </div>

      {/* ── TOP10 + 재고 TOP10 ── */}
      <div className="g2" style={{ marginBottom:12 }}>
        {/* 판매 TOP 10 */}
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🥇</div><div><div className="ch-title">판매 TOP 10</div></div></div>
          </div>
          <div style={{ padding:'4px 14px 4px' }}>
            <DateFilter dateRange={topRange} onChange={setTopRange} />
          </div>
          <div className="cb" style={{ padding:'4px 14px 10px' }}>
            {topSales.length > 0 ? (
              <div className="tw"><table>
                <thead><tr><th>#</th><th colSpan={2}>상품명</th><th>판매량</th><th>매출</th></tr></thead>
                <tbody>
                  {topSales.map((item, i) => (
                    <tr key={i}>
                      <td><span className={`rank-medal ${['rm1','rm2','rm3','rmn','rmn','rmn','rmn','rmn','rmn','rmn'][i]}`}>{i+1}</span></td>
                      <td style={{ width:32 }}>
                        {item.img
                          ? <img src={item.img} alt="" style={{ width:28, height:28, borderRadius:4, objectFit:'cover' }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                          : <div style={{ width:28, height:28, borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'var(--t3)' }}>-</div>
                        }
                      </td>
                      <td style={{ fontWeight:700, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.name}</td>
                      <td style={{ fontWeight:700 }}>{fmt(item.qty)}</td>
                      <td style={{ fontWeight:800, color:'var(--blue)', fontSize:11 }}>{fmt(item.rev)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : <div className="empty-st"><div className="es-ico">🥇</div><div className="es-t">데이터 로딩 중...</div></div>}
          </div>
        </div>

        {/* 재고 TOP 10 */}
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">📦</div><div><div className="ch-title">재고 TOP 10</div></div></div>
          </div>
          <div className="cb" style={{ padding:'8px 14px 10px' }}>
            {stockTop10.length > 0 ? (
              <div className="tw"><table>
                <thead><tr><th>#</th><th colSpan={2}>상품명</th><th>FC</th><th>VF</th><th>합계</th></tr></thead>
                <tbody>
                  {stockTop10.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontSize:11, color:'var(--t3)' }}>{i+1}</td>
                      <td style={{ width:32 }}>
                        {p.imageUrl
                          ? <img src={p.imageUrl} alt="" style={{ width:28, height:28, borderRadius:4, objectFit:'cover' }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                          : <div style={{ width:28, height:28, borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10 }}>-</div>
                        }
                      </td>
                      <td style={{ fontWeight:700, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</td>
                      <td style={{ fontSize:11 }}>{fmt(p.fcStock)}</td>
                      <td style={{ fontSize:11 }}>{fmt(p.vfStock)}</td>
                      <td style={{ fontWeight:800, color:'var(--green)' }}>{fmt(p.fcStock+p.vfStock+p.hqStock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : <div className="empty-st"><div className="es-ico">📦</div><div className="es-t">데이터 로딩 중...</div></div>}
          </div>
        </div>
      </div>

      {/* ── 재고 소진 예상 ── */}
      <div className="card" style={{ marginBottom:12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">⚠️</div><div>
            <div className="ch-title">재고 소진 예상</div>
            <div className="ch-sub">위험·주의 품목 — 이지어드민 기준</div>
          </div></div>
        </div>
        <div style={{ padding:'4px 14px 4px' }}>
          <DateFilter dateRange={stockRange} onChange={setStockRange} />
        </div>
        <div className="cb" style={{ padding:'4px 14px 10px' }}>
          {stockSales.length > 0 ? (
            <div className="tw"><table>
              <thead><tr><th colSpan={2}>상품명</th><th>재고</th><th>일판매</th><th>소진예상</th><th>상태</th></tr></thead>
              <tbody>
                {stockSales.map((item, i) => (
                  <>
                    <tr key={i} style={{ cursor:'pointer' }} onClick={() => {
                      const next = new Set(expandedStock)
                      next.has(item.name) ? next.delete(item.name) : next.add(item.name)
                      setExpandedStock(next)
                    }}>
                      <td style={{ width:32 }}>
                        {item.img
                          ? <img src={item.img} alt="" style={{ width:28, height:28, borderRadius:4, objectFit:'cover' }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                          : <div style={{ width:28, height:28, borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10 }}>-</div>
                        }
                      </td>
                      <td style={{ fontWeight:700 }}>
                        <span style={{ marginRight:6, fontSize:10, color:'var(--t3)' }}>{expandedStock.has(item.name) ? '▼' : '▶'}</span>
                        {item.name}
                      </td>
                      <td style={{ fontWeight:700 }}>{fmt(item.stock)}</td>
                      <td style={{ fontSize:11, color:'var(--t3)' }}>{item.rate.toFixed(1)}/일</td>
                      <td style={{ fontWeight:800, color: item.status==='danger' ? 'var(--red)' : 'var(--amber)' }}>
                        {item.daysLeft >= 999 ? '충분' : `${item.daysLeft}일`}
                      </td>
                      <td>
                        {item.status==='danger'
                          ? <span className="badge b-re">🚨 긴급</span>
                          : <span className="badge b-am">⚠️ 주의</span>
                        }
                      </td>
                    </tr>
                    {expandedStock.has(item.name) && item.prods.map((p, j) => (
                      <tr key={`sub-${i}-${j}`} style={{ background:'var(--bg)', fontSize:11 }}>
                        <td></td>
                        <td style={{ color:'var(--t2)', paddingLeft:24 }}>
                          └ {p.optionValue || p.barcode}
                        </td>
                        <td style={{ color:'var(--t2)' }}>{fmt(p.fcStock+p.vfStock)}</td>
                        <td style={{ color:'var(--t3)', fontSize:10 }}>FC:{p.fcStock} VF:{p.vfStock}</td>
                        <td colSpan={2} style={{ color:'var(--t3)', fontSize:10 }}>{p.barcode}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty-st"><div className="es-ico">⚠️</div><div className="es-t">재고 데이터 로딩 중...</div></div>}
        </div>
      </div>

      {/* ── 광고 요약 (최하단) ── */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📣</div><div>
            <div className="ch-title">광고 요약</div>
          </div></div>
          <button onClick={() => { const nav = (window as Record<string,unknown>).navigateTo as ((p:string)=>void); nav && nav('/ad') }}
            className="btn-g" style={{ fontSize:11, padding:'5px 10px', cursor:'pointer', border:'none' }}>상세 →</button>
        </div>
        <div className="cb">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8 }}>
            {[
              { label:'ROAS',   value:roas,        color:'var(--green)', note:'목표 3.5 이상' },
              { label:'ACoS',   value:acos,        color:'var(--blue)',  note:'목표 25% 이하' },
              { label:'광고비',  value:fmt(adCost), color:'var(--text)',  note:'기간 집행' },
              { label:'광고매출', value:fmt(adRev),  color:'var(--text)',  note:'기간 기여' },
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
    </div>
  )
}

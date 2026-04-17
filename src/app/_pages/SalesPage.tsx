'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useApp } from '@/lib/store'
import { toYMD, fromYMD } from '@/lib/dateUtils'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

// ─── 보조 타입 ───
type Mode = 'qty' | 'rev'  // 수량 / 금액 토글

// 상품(이지어드민 상품명) 단위 집계
interface ProductAgg {
  productName:  string
  imageUrl:     string
  season:       string
  category:     string
  ytdQty:       number               // 누적 (1/1 ~ 전일)
  ytdRev:       number
  weekQty:      number               // 최근 7일 (전일 포함)
  weekRev:      number
  rangeDaily:   { date: string; qty: number; rev: number }[]  // 달력 필터 기간 내 날짜별 합
  options:      OptionAgg[]          // 토글 펼침
}

// 옵션(바코드) 단위 집계
interface OptionAgg {
  barcode:    string
  option:     string
  cost:       number
  ytdQty:     number
  ytdRev:     number
  weekQty:    number
  weekRev:    number
  rangeQty:   number
  rangeRev:   number
}

// ─── 스파크라인 (순수 SVG) ───
function Sparkline({ data, mode }: { data: { date: string; qty: number; rev: number }[]; mode: Mode }) {
  if (!data.length) return <span style={{ color: 'var(--t3)', fontSize: 11 }}>—</span>
  const values = data.map(d => (mode === 'qty' ? d.qty : d.rev))
  const max = Math.max(...values, 1)
  const W = 110, H = 32, BW = Math.max(2, Math.floor(W / data.length) - 2)
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {data.map((d, i) => {
        const v = mode === 'qty' ? d.qty : d.rev
        const h = v > 0 ? Math.max(2, (v / max) * (H - 4)) : 0
        const x = i * (W / data.length) + 1
        return (
          <g key={d.date}>
            <rect
              x={x} y={H - h - 1} width={BW} height={h}
              rx={1.5} fill="var(--blue)" opacity={0.85}
            >
              <title>{`${d.date}: ${Math.round(v).toLocaleString('ko-KR')}`}</title>
            </rect>
          </g>
        )
      })}
    </svg>
  )
}

export default function SalesPage() {
  const { state } = useApp()
  const { salesData, latestSaleDate } = state

  // ─── 달력 필터 (페이지 전용 상태) ───
  // 디폴트: 최근일 기준 7일 (latestSaleDate 기준). 없으면 어제 기준.
  const defaultRange = useMemo(() => {
    const anchor = latestSaleDate ? fromYMD(latestSaleDate) : (() => {
      const y = new Date(); y.setHours(0,0,0,0); y.setDate(y.getDate() - 1); return y
    })()
    const from = new Date(anchor); from.setDate(from.getDate() - 6)
    return { from: toYMD(from), to: toYMD(anchor) }
  }, [latestSaleDate])

  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate,   setToDate]   = useState(defaultRange.to)

  // latestSaleDate가 뒤늦게 hydrate되면 디폴트 반영
  useEffect(() => {
    setFromDate(defaultRange.from)
    setToDate(defaultRange.to)
  }, [defaultRange.from, defaultRange.to])

  const [mode, setMode] = useState<Mode>('qty')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // ─── 날짜 기준점들 ───
  // 누적: 올해 1/1 ~ 전일
  // 주간: 최근일 기준 7일
  // 필터: fromDate ~ toDate
  const todayAnchor = useMemo(() => latestSaleDate || (() => {
    const y = new Date(); y.setHours(0,0,0,0); y.setDate(y.getDate() - 1)
    return toYMD(y)
  })(), [latestSaleDate])

  const weekFromYMD = useMemo(() => {
    const d = fromYMD(todayAnchor); d.setDate(d.getDate() - 6)
    return toYMD(d)
  }, [todayAnchor])

  const yearStart = `${new Date().getFullYear()}-01-01`

  // ─── 상품별 집계 ───
  const products: ProductAgg[] = useMemo(() => {
    if (!salesData.length) return []

    // productName 단위로 묶고, 그 안에서 barcode(옵션) 단위로도 묶기
    interface ProdBuilder {
      productName: string
      imageUrl:    string
      season:      string
      category:    string
      optMap:      Map<string, OptionAgg>
      ytdQty: number; ytdRev: number
      weekQty: number; weekRev: number
      rangeDaily: Map<string, { qty: number; rev: number }>
    }
    const map = new Map<string, ProdBuilder>()

    // 기간 내 날짜들을 미리 만들어두기 (0-fill용)
    const rangeDates: string[] = []
    {
      const f = fromYMD(fromDate), t = fromYMD(toDate)
      const d = new Date(f)
      while (d <= t) {
        rangeDates.push(toYMD(d))
        d.setDate(d.getDate() + 1)
      }
    }

    for (const r of salesData) {
      if (r.isReturn) continue
      const name = r.productName || '—'
      const key = name
      let p = map.get(key)
      if (!p) {
        p = {
          productName: name,
          imageUrl:    r.imageUrl || '',
          season:      r.season || '',
          category:    r.category || '',
          optMap:      new Map(),
          ytdQty: 0, ytdRev: 0,
          weekQty: 0, weekRev: 0,
          rangeDaily: new Map(rangeDates.map(d => [d, { qty: 0, rev: 0 }])),
        }
        map.set(key, p)
      }
      // 메타가 비어있었는데 다른 행에 있으면 보강
      if (!p.imageUrl && r.imageUrl) p.imageUrl = r.imageUrl
      if (!p.season   && r.season)   p.season   = r.season
      if (!p.category && r.category) p.category = r.category

      const qty = r.qty || 0
      const rev = (r.cost || 0) * qty  // 금액 = 원가 × 수량

      // 옵션(바코드) 집계
      const bc = r.barcode || r.option || ''
      const optKey = bc || r.option || '(단일)'
      let o = p.optMap.get(optKey)
      if (!o) {
        o = {
          barcode: bc,
          option:  r.option || '',
          cost:    r.cost || 0,
          ytdQty: 0, ytdRev: 0,
          weekQty: 0, weekRev: 0,
          rangeQty: 0, rangeRev: 0,
        }
        p.optMap.set(optKey, o)
      }

      // 누적 (올해 1/1 ~ 전일까지)
      if (r.date >= yearStart && r.date <= todayAnchor) {
        p.ytdQty += qty; p.ytdRev += rev
        o.ytdQty += qty; o.ytdRev += rev
      }
      // 주간
      if (r.date >= weekFromYMD && r.date <= todayAnchor) {
        p.weekQty += qty; p.weekRev += rev
        o.weekQty += qty; o.weekRev += rev
      }
      // 필터 기간
      if (r.date >= fromDate && r.date <= toDate) {
        o.rangeQty += qty; o.rangeRev += rev
        const slot = p.rangeDaily.get(r.date)
        if (slot) { slot.qty += qty; slot.rev += rev }
      }
    }

    // 정리
    const result: ProductAgg[] = []
    map.forEach(p => {
      const options = Array.from(p.optMap.values()).sort((a, b) => b.ytdQty - a.ytdQty)
      const rangeDaily = rangeDates.map(d => ({
        date: d,
        qty: p.rangeDaily.get(d)?.qty || 0,
        rev: p.rangeDaily.get(d)?.rev || 0,
      }))
      result.push({
        productName: p.productName,
        imageUrl:    p.imageUrl,
        season:      p.season,
        category:    p.category,
        ytdQty:      p.ytdQty,
        ytdRev:      p.ytdRev,
        weekQty:     p.weekQty,
        weekRev:     p.weekRev,
        rangeDaily,
        options,
      })
    })
    // 기본 정렬 = 누적 수량 내림차순
    result.sort((a, b) => b.ytdQty - a.ytdQty)
    return result
  }, [salesData, fromDate, toDate, todayAnchor, weekFromYMD, yearStart])

  // 검색 필터
  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const s = search.toLowerCase()
    return products.filter(p =>
      p.productName.toLowerCase().includes(s)
      || p.season.toLowerCase().includes(s)
      || p.category.toLowerCase().includes(s)
      || p.options.some(o => (o.barcode + ' ' + o.option).toLowerCase().includes(s))
    )
  }, [products, search])

  // 합계 계산 (현재 필터 결과 기준)
  const totals = useMemo(() => {
    let ytdQty = 0, ytdRev = 0, weekQty = 0, weekRev = 0, rangeQty = 0, rangeRev = 0
    const rangeDailyTotal = new Map<string, { qty: number; rev: number }>()
    filtered.forEach(p => {
      ytdQty += p.ytdQty; ytdRev += p.ytdRev
      weekQty += p.weekQty; weekRev += p.weekRev
      p.rangeDaily.forEach(d => {
        rangeQty += d.qty; rangeRev += d.rev
        const slot = rangeDailyTotal.get(d.date) || { qty: 0, rev: 0 }
        slot.qty += d.qty; slot.rev += d.rev
        rangeDailyTotal.set(d.date, slot)
      })
    })
    const rangeDaily = Array.from(rangeDailyTotal.entries())
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([date, v]) => ({ date, ...v }))
    return { ytdQty, ytdRev, weekQty, weekRev, rangeQty, rangeRev, rangeDaily }
  }, [filtered])

  // ─── 시즌별 / 카테고리별 집계 (필터 기간 기준) ───
  const bySeason = useMemo(() => {
    const m = new Map<string, { qty: number; rev: number }>()
    products.forEach(p => {
      const key = p.season || '미지정'
      const cur = m.get(key) || { qty: 0, rev: 0 }
      p.rangeDaily.forEach(d => { cur.qty += d.qty; cur.rev += d.rev })
      m.set(key, cur)
    })
    return Array.from(m.entries())
      .map(([k, v]) => ({ label: k, ...v }))
      .sort((a, b) => (mode === 'qty' ? b.qty - a.qty : b.rev - a.rev))
  }, [products, mode])

  const byCategory = useMemo(() => {
    const m = new Map<string, { qty: number; rev: number }>()
    products.forEach(p => {
      const key = p.category || '미지정'
      const cur = m.get(key) || { qty: 0, rev: 0 }
      p.rangeDaily.forEach(d => { cur.qty += d.qty; cur.rev += d.rev })
      m.set(key, cur)
    })
    return Array.from(m.entries())
      .map(([k, v]) => ({ label: k, ...v }))
      .sort((a, b) => (mode === 'qty' ? b.qty - a.qty : b.rev - a.rev))
  }, [products, mode])

  // ─── 차트 렌더링 ───
  const seasonRef = useRef<HTMLCanvasElement>(null)
  const seasonChart = useRef<Chart | null>(null)
  const catRef = useRef<HTMLCanvasElement>(null)
  const catChart = useRef<Chart | null>(null)

  useEffect(() => {
    if (!seasonRef.current) return
    seasonChart.current?.destroy()
    if (!bySeason.length) return
    seasonChart.current = new Chart(seasonRef.current, {
      type: 'bar',
      data: {
        labels: bySeason.map(s => s.label),
        datasets: [{
          label: mode === 'qty' ? '판매량' : '금액',
          data: bySeason.map(s => (mode === 'qty' ? s.qty : Math.round(s.rev))),
          backgroundColor: '#1570EF',
          borderRadius: 6,
          barThickness: 32,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ' ' + Number(ctx.parsed.y).toLocaleString('ko-KR') } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' as const }, color: '#56606E' } },
          y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 10 }, color: '#56606E', callback: (v) => Number(v).toLocaleString('ko-KR') } },
        },
      },
    })
    return () => { seasonChart.current?.destroy() }
  }, [bySeason, mode])

  useEffect(() => {
    if (!catRef.current) return
    catChart.current?.destroy()
    if (!byCategory.length) return
    catChart.current = new Chart(catRef.current, {
      type: 'bar',
      data: {
        labels: byCategory.map(s => s.label),
        datasets: [{
          label: mode === 'qty' ? '판매량' : '금액',
          data: byCategory.map(s => (mode === 'qty' ? s.qty : Math.round(s.rev))),
          backgroundColor: '#12B76A',
          borderRadius: 6,
          barThickness: 32,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ' ' + Number(ctx.parsed.y).toLocaleString('ko-KR') } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' as const }, color: '#56606E' } },
          y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 10 }, color: '#56606E', callback: (v) => Number(v).toLocaleString('ko-KR') } },
        },
      },
    })
    return () => { catChart.current?.destroy() }
  }, [byCategory, mode])

  // ─── 렌더 유틸 ───
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const toggleRow = (key: string) => {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key); else next.add(key)
    setExpanded(next)
  }

  // 빠른 프리셋
  function applyQuickPreset(days: number) {
    const anchor = latestSaleDate ? fromYMD(latestSaleDate) : (() => {
      const y = new Date(); y.setHours(0,0,0,0); y.setDate(y.getDate() - 1); return y
    })()
    const f = new Date(anchor); f.setDate(f.getDate() - (days - 1))
    setFromDate(toYMD(f))
    setToDate(toYMD(anchor))
  }

  return (
    <div>
      {/* ─── 페이지 전용 필터 바 ─── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cb" style={{ padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="dp" onClick={() => applyQuickPreset(7)}>최근 7일</button>
            <button className="dp" onClick={() => applyQuickPreset(14)}>최근 14일</button>
            <button className="dp" onClick={() => applyQuickPreset(30)}>최근 30일</button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" className="date-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <span className="date-range-sep">~</span>
            <input type="date" className="date-input" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <span className="date-label-txt">
            {fromDate} ~ {toDate} ({todayAnchor ? `최근일 ${todayAnchor}` : '데이터 없음'})
          </span>
          <div style={{ flex: 1 }} />
          {/* 수량 / 금액 토글 */}
          <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #E4E7EC' }}>
            <button
              onClick={() => setMode('qty')}
              style={{
                padding: '8px 14px', fontSize: 12, fontWeight: 800,
                background: mode === 'qty' ? 'var(--blue)' : '#fff',
                color: mode === 'qty' ? '#fff' : 'var(--t2)',
                border: 'none', cursor: 'pointer',
              }}
            >수량 보기</button>
            <button
              onClick={() => setMode('rev')}
              style={{
                padding: '8px 14px', fontSize: 12, fontWeight: 800,
                background: mode === 'rev' ? 'var(--blue)' : '#fff',
                color: mode === 'rev' ? '#fff' : 'var(--t2)',
                border: 'none', cursor: 'pointer',
              }}
            >금액 보기</button>
          </div>
        </div>
      </div>

      {/* ─── 시즌별 / 카테고리별 차트 ─── */}
      <div className="g2">
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🗓️</div><div>
              <div className="ch-title">시즌별 판매 ({mode === 'qty' ? '수량' : '금액'})</div>
              <div className="ch-sub">{fromDate} ~ {toDate}</div>
            </div></div>
          </div>
          <div className="cb">
            {bySeason.length > 0
              ? <div style={{ position: 'relative', height: 240 }}><canvas ref={seasonRef} /></div>
              : <div className="empty-st"><div className="es-ico">🗓️</div><div className="es-t">기간 내 시즌 데이터가 없어요</div></div>
            }
          </div>
        </div>
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">📦</div><div>
              <div className="ch-title">카테고리별 판매 ({mode === 'qty' ? '수량' : '금액'})</div>
              <div className="ch-sub">{fromDate} ~ {toDate}</div>
            </div></div>
          </div>
          <div className="cb">
            {byCategory.length > 0
              ? <div style={{ position: 'relative', height: 240 }}><canvas ref={catRef} /></div>
              : <div className="empty-st"><div className="es-ico">📦</div><div className="es-t">기간 내 카테고리 데이터가 없어요</div></div>
            }
          </div>
        </div>
      </div>

      {/* ─── 상품별 판매 상세 ─── */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📝</div><div>
            <div className="ch-title">상품별 판매 상세</div>
            <div className="ch-sub">이지어드민 상품명 기준 · 토글을 열면 옵션별 상세</div>
          </div></div>
        </div>
        <div className="cb">
          <div className="frow">
            <input className="si" placeholder="🔍 상품명 · 옵션 · 시즌 · 카테고리 검색..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ width: 52 }}></th>
                  <th>상품명</th>
                  <th style={{ width: 90, textAlign: 'right' }}>누적<br /><span style={{ fontWeight: 500, color: 'var(--t3)', fontSize: 10 }}>1/1~{todayAnchor.slice(5)}</span></th>
                  <th style={{ width: 80, textAlign: 'right' }}>주간<br /><span style={{ fontWeight: 500, color: 'var(--t3)', fontSize: 10 }}>최근 7일</span></th>
                  <th style={{ width: 140 }}>일 판매량<br /><span style={{ fontWeight: 500, color: 'var(--t3)', fontSize: 10 }}>{fromDate}~{toDate}</span></th>
                  <th style={{ width: 80, textAlign: 'right' }}>기간 합</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length > 0 ? filtered.map((p) => {
                  const isOpen = expanded.has(p.productName)
                  return (
                    <>
                      <tr key={p.productName} style={{ cursor: 'pointer' }} onClick={() => toggleRow(p.productName)}>
                        <td style={{ textAlign: 'center', color: 'var(--t3)', fontWeight: 800 }}>
                          {isOpen ? '▾' : '▸'}
                        </td>
                        <td>
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt=""
                              style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', border: '1px solid #E4E7EC', background: '#F9FAFB' }}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                            />
                          ) : (
                            <div style={{ width: 40, height: 40, borderRadius: 6, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 14 }}>📦</div>
                          )}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          <div style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.productName}</div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                            {p.season   && <span className="badge b-bl" style={{ fontSize: 10 }}>{p.season}</span>}
                            {p.category && <span className="badge b-gr" style={{ fontSize: 10 }}>{p.category}</span>}
                            <span style={{ fontSize: 10, color: 'var(--t3)' }}>옵션 {p.options.length}개</span>
                          </div>
                        </td>
                        <td style={{ fontWeight: 800, color: 'var(--blue)', textAlign: 'right' }}>
                          {fmt(mode === 'qty' ? p.ytdQty : p.ytdRev)}
                        </td>
                        <td style={{ fontWeight: 700, textAlign: 'right' }}>
                          {fmt(mode === 'qty' ? p.weekQty : p.weekRev)}
                        </td>
                        <td>
                          <Sparkline data={p.rangeDaily} mode={mode} />
                        </td>
                        <td style={{ fontWeight: 800, textAlign: 'right' }}>
                          {fmt(
                            mode === 'qty'
                              ? p.rangeDaily.reduce((s, d) => s + d.qty, 0)
                              : p.rangeDaily.reduce((s, d) => s + d.rev, 0)
                          )}
                        </td>
                      </tr>
                      {isOpen && p.options.map((o, i) => (
                        <tr key={p.productName + '|' + (o.barcode || o.option || i)} style={{ background: '#FAFBFC' }}>
                          <td></td>
                          <td></td>
                          <td style={{ paddingLeft: 20, fontSize: 12, color: 'var(--t2)' }}>
                            ↳ {o.option || '(옵션 없음)'}
                            {o.barcode && <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 6 }}>#{o.barcode}</span>}
                            {mode === 'rev' && o.cost > 0 && (
                              <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 6 }}>원가 {fmt(o.cost)}</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(mode === 'qty' ? o.ytdQty : o.ytdRev)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(mode === 'qty' ? o.weekQty : o.weekRev)}</td>
                          <td style={{ fontSize: 11, color: 'var(--t3)' }}>—</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(mode === 'qty' ? o.rangeQty : o.rangeRev)}</td>
                        </tr>
                      ))}
                    </>
                  )
                }) : (
                  <tr><td colSpan={7}><div className="empty-st"><div className="es-ico">🛒</div><div className="es-t">{salesData.length ? '검색 결과 없음' : '판매 데이터를 업로드해주세요'}</div></div></td></tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#F3F7FF', fontWeight: 800, borderTop: '2px solid var(--blue)' }}>
                    <td></td>
                    <td></td>
                    <td style={{ fontWeight: 800 }}>합계 ({filtered.length}개 상품)</td>
                    <td style={{ textAlign: 'right', color: 'var(--blue)' }}>{fmt(mode === 'qty' ? totals.ytdQty : totals.ytdRev)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(mode === 'qty' ? totals.weekQty : totals.weekRev)}</td>
                    <td><Sparkline data={totals.rangeDaily} mode={mode} /></td>
                    <td style={{ textAlign: 'right' }}>{fmt(mode === 'qty' ? totals.rangeQty : totals.rangeRev)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

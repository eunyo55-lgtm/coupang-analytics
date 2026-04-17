'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
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
  category:     string                  // 상품명의 '-' 앞 부분에서 자동 추출
  ytdQty:       number                  // 누적 (1/1 ~ 전일)
  ytdRev:       number
  weekQty:      number                  // 최근 7일 (전일 포함)
  weekRev:      number
  rangeDaily:   { date: string; qty: number; rev: number }[]  // 달력 필터 기간 내 날짜별
  options:      OptionAgg[]             // 토글 펼침
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
  rangeDaily: { date: string; qty: number; rev: number }[]
}

// ─── 카테고리 추출: 상품명의 '-' 앞부분 ───
// 예: '실내화-꾸꾸'  → '실내화'
//     '상의-나이스' → '상의'
//     '장화'        → '장화'
function extractCategory(productName: string): string {
  if (!productName) return '미지정'
  const idx = productName.indexOf('-')
  const head = idx > 0 ? productName.slice(0, idx) : productName
  return head.trim() || '미지정'
}

// ─── 날짜 헤더 포맷: '03/29' ───
function formatMD(ymd: string): string {
  return ymd.length >= 10 ? ymd.slice(5).replace('-', '/') : ymd
}

// 주말(토/일) 컬러 강조
function dayColor(ymd: string): string {
  const d = fromYMD(ymd)
  const dow = d.getDay() // 0=일, 6=토
  return dow === 0 ? '#F04438' : dow === 6 ? '#1570EF' : 'var(--t2)'
}

export default function SalesPage() {
  const { state } = useApp()
  const { salesData, latestSaleDate } = state

  // ─── 달력 필터 (페이지 전용 상태) ───
  // 디폴트: 최근일 기준 30일
  const defaultRange = useMemo(() => {
    const anchor = latestSaleDate ? fromYMD(latestSaleDate) : (() => {
      const y = new Date(); y.setHours(0,0,0,0); y.setDate(y.getDate() - 1); return y
    })()
    const from = new Date(anchor); from.setDate(from.getDate() - 29)  // 30일 (오늘 포함)
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
  const todayAnchor = useMemo(() => latestSaleDate || (() => {
    const y = new Date(); y.setHours(0,0,0,0); y.setDate(y.getDate() - 1)
    return toYMD(y)
  })(), [latestSaleDate])

  const weekFromYMD = useMemo(() => {
    const d = fromYMD(todayAnchor); d.setDate(d.getDate() - 6)
    return toYMD(d)
  }, [todayAnchor])

  const yearStart = `${new Date().getFullYear()}-01-01`

  // ─── 기간 내 날짜 배열 (0-fill용) ───
  const rangeDates: string[] = useMemo(() => {
    const arr: string[] = []
    const f = fromYMD(fromDate), t = fromYMD(toDate)
    const d = new Date(f)
    while (d <= t) {
      arr.push(toYMD(d))
      d.setDate(d.getDate() + 1)
    }
    return arr
  }, [fromDate, toDate])

  // ─── 상품별 집계 ───
  const products: ProductAgg[] = useMemo(() => {
    if (!salesData.length) return []

    interface ProdBuilder {
      productName: string
      imageUrl:    string
      season:      string
      category:    string
      optMap:      Map<string, {
        barcode: string; option: string; cost: number
        ytdQty: number; ytdRev: number
        weekQty: number; weekRev: number
        rangeDaily: Map<string, { qty: number; rev: number }>
      }>
      ytdQty: number; ytdRev: number
      weekQty: number; weekRev: number
      rangeDaily: Map<string, { qty: number; rev: number }>
    }
    const map = new Map<string, ProdBuilder>()

    const emptyDaily = () => new Map(rangeDates.map(d => [d, { qty: 0, rev: 0 }]))

    for (const r of salesData) {
      if (r.isReturn) continue
      const name = r.productName || '—'
      let p = map.get(name)
      if (!p) {
        p = {
          productName: name,
          imageUrl:    r.imageUrl || '',
          season:      r.season || '',
          category:    extractCategory(name),  // 상품명에서 추출
          optMap:      new Map(),
          ytdQty: 0, ytdRev: 0,
          weekQty: 0, weekRev: 0,
          rangeDaily: emptyDaily(),
        }
        map.set(name, p)
      }
      if (!p.imageUrl && r.imageUrl) p.imageUrl = r.imageUrl
      if (!p.season   && r.season)   p.season   = r.season

      const qty = r.qty || 0
      const rev = (r.cost || 0) * qty

      // 옵션 집계
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
          rangeDaily: emptyDaily(),
        }
        p.optMap.set(optKey, o)
      }

      // 누적
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
        const pSlot = p.rangeDaily.get(r.date)
        if (pSlot) { pSlot.qty += qty; pSlot.rev += rev }
        const oSlot = o.rangeDaily.get(r.date)
        if (oSlot) { oSlot.qty += qty; oSlot.rev += rev }
      }
    }

    const result: ProductAgg[] = []
    map.forEach(p => {
      const options: OptionAgg[] = Array.from(p.optMap.values())
        .map(o => ({
          barcode:    o.barcode,
          option:     o.option,
          cost:       o.cost,
          ytdQty:     o.ytdQty,
          ytdRev:     o.ytdRev,
          weekQty:    o.weekQty,
          weekRev:    o.weekRev,
          rangeDaily: rangeDates.map(d => ({
            date: d,
            qty: o.rangeDaily.get(d)?.qty || 0,
            rev: o.rangeDaily.get(d)?.rev || 0,
          })),
        }))
        .sort((a, b) => b.ytdQty - a.ytdQty)

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
    result.sort((a, b) => b.ytdQty - a.ytdQty)
    return result
  }, [salesData, fromDate, toDate, todayAnchor, weekFromYMD, yearStart, rangeDates])

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

  // 합계 계산
  const totals = useMemo(() => {
    let ytdQty = 0, ytdRev = 0, weekQty = 0, weekRev = 0
    const dailyTotal = new Map<string, { qty: number; rev: number }>(
      rangeDates.map(d => [d, { qty: 0, rev: 0 }])
    )
    filtered.forEach(p => {
      ytdQty += p.ytdQty; ytdRev += p.ytdRev
      weekQty += p.weekQty; weekRev += p.weekRev
      p.rangeDaily.forEach(d => {
        const slot = dailyTotal.get(d.date)
        if (slot) { slot.qty += d.qty; slot.rev += d.rev }
      })
    })
    const rangeDaily = rangeDates.map(d => ({
      date: d,
      qty: dailyTotal.get(d)?.qty || 0,
      rev: dailyTotal.get(d)?.rev || 0,
    }))
    return { ytdQty, ytdRev, weekQty, weekRev, rangeDaily }
  }, [filtered, rangeDates])

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

  // 숫자 셀 스타일 (0은 흐리게)
  const numCellStyle = (v: number): React.CSSProperties => ({
    textAlign: 'right',
    padding: '6px 8px',
    fontSize: 12,
    fontWeight: v > 0 ? 600 : 400,
    color: v > 0 ? 'var(--t1)' : 'var(--t3)',
    whiteSpace: 'nowrap',
  })

  const dateHeaderStyle = (ymd: string): React.CSSProperties => ({
    padding: '8px 6px',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    color: dayColor(ymd),
    background: '#F9FAFB',
    borderBottom: '1px solid #E4E7EC',
    minWidth: 48,
  })

  return (
    <div>
      {/* ─── 페이지 전용 필터 바 ─── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cb" style={{ padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>📅 기간</span>
            <input type="date" className="date-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <span className="date-range-sep">~</span>
            <input type="date" className="date-input" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <span className="date-label-txt" style={{ fontSize: 11, color: 'var(--t3)' }}>
            {rangeDates.length}일 · 최근 판매일 {todayAnchor || '—'}
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
              <div className="ch-sub">상품명 앞부분 기준 · {fromDate} ~ {toDate}</div>
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
            <div className="ch-sub">상품명 클릭 → 옵션별 펼치기 · 날짜는 가로 스크롤로 확인</div>
          </div></div>
        </div>
        <div className="cb">
          <div className="frow">
            <input className="si" placeholder="🔍 상품명 · 옵션 · 시즌 · 카테고리 검색..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* 가로 스크롤 테이블 */}
          <div style={{ overflowX: 'auto', border: '1px solid #E4E7EC', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 28, position: 'sticky', left: 0, background: '#F9FAFB', zIndex: 4, borderBottom: '1px solid #E4E7EC' }}></th>
                  <th style={{ width: 52, position: 'sticky', left: 28, background: '#F9FAFB', zIndex: 4, borderBottom: '1px solid #E4E7EC' }}></th>
                  <th style={{
                    minWidth: 260, textAlign: 'left', padding: '8px 10px',
                    position: 'sticky', left: 80, background: '#F9FAFB', zIndex: 4,
                    borderBottom: '1px solid #E4E7EC', fontSize: 12,
                  }}>상품명</th>
                  <th style={{
                    width: 90, textAlign: 'right', padding: '8px 10px', background: '#F9FAFB',
                    borderBottom: '1px solid #E4E7EC', fontSize: 12,
                  }}>
                    누적
                    <div style={{ fontWeight: 500, color: 'var(--t3)', fontSize: 10 }}>1/1~{todayAnchor.slice(5)}</div>
                  </th>
                  <th style={{
                    width: 80, textAlign: 'right', padding: '8px 10px', background: '#F9FAFB',
                    borderBottom: '1px solid #E4E7EC', fontSize: 12,
                    borderRight: '2px solid #E4E7EC',
                  }}>
                    주간
                    <div style={{ fontWeight: 500, color: 'var(--t3)', fontSize: 10 }}>최근 7일</div>
                  </th>
                  {rangeDates.map(d => (
                    <th key={d} style={dateHeaderStyle(d)}>{formatMD(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length > 0 ? filtered.map((p) => {
                  const isOpen = expanded.has(p.productName)
                  return (
                    <React.Fragment key={p.productName}>
                      <tr
                        style={{ cursor: 'pointer', borderTop: '1px solid #F3F4F6' }}
                        onClick={() => toggleRow(p.productName)}
                      >
                        <td style={{ textAlign: 'center', color: 'var(--t3)', fontWeight: 800, position: 'sticky', left: 0, background: '#fff', zIndex: 2 }}>
                          {isOpen ? '▾' : '▸'}
                        </td>
                        <td style={{ padding: 4, position: 'sticky', left: 28, background: '#fff', zIndex: 2 }}>
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
                        <td style={{ fontWeight: 700, padding: '6px 10px', position: 'sticky', left: 80, background: '#fff', zIndex: 2, borderRight: '1px solid #F3F4F6' }}>
                          <div style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.productName}</div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                            {p.category && <span className="badge b-gr" style={{ fontSize: 10 }}>{p.category}</span>}
                            {p.season   && <span className="badge b-bl" style={{ fontSize: 10 }}>{p.season}</span>}
                            <span style={{ fontSize: 10, color: 'var(--t3)' }}>옵션 {p.options.length}개</span>
                          </div>
                        </td>
                        <td style={{ fontWeight: 800, color: 'var(--blue)', textAlign: 'right', padding: '6px 10px' }}>
                          {fmt(mode === 'qty' ? p.ytdQty : p.ytdRev)}
                        </td>
                        <td style={{ fontWeight: 700, textAlign: 'right', padding: '6px 10px', borderRight: '2px solid #E4E7EC' }}>
                          {fmt(mode === 'qty' ? p.weekQty : p.weekRev)}
                        </td>
                        {p.rangeDaily.map(d => {
                          const v = mode === 'qty' ? d.qty : d.rev
                          return <td key={d.date} style={numCellStyle(v)}>{v > 0 ? fmt(v) : '·'}</td>
                        })}
                      </tr>
                      {isOpen && p.options.map((o, i) => (
                        <tr
                          key={p.productName + '|' + (o.barcode || o.option || i)}
                          style={{ background: '#FAFBFC', borderTop: '1px solid #F3F4F6' }}
                        >
                          <td style={{ position: 'sticky', left: 0, background: '#FAFBFC', zIndex: 1 }}></td>
                          <td style={{ position: 'sticky', left: 28, background: '#FAFBFC', zIndex: 1 }}></td>
                          <td style={{
                            fontSize: 12, color: 'var(--t2)',
                            position: 'sticky', left: 80, background: '#FAFBFC', zIndex: 1,
                            borderRight: '1px solid #F3F4F6', padding: '6px 10px 6px 24px',
                          }}>
                            ↳ {o.option || '(옵션 없음)'}
                            {o.barcode && <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 6 }}>#{o.barcode}</span>}
                            {mode === 'rev' && o.cost > 0 && (
                              <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 6 }}>원가 {fmt(o.cost)}</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 12, padding: '6px 10px' }}>
                            {fmt(mode === 'qty' ? o.ytdQty : o.ytdRev)}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 12, padding: '6px 10px', borderRight: '2px solid #E4E7EC' }}>
                            {fmt(mode === 'qty' ? o.weekQty : o.weekRev)}
                          </td>
                          {o.rangeDaily.map(d => {
                            const v = mode === 'qty' ? d.qty : d.rev
                            return <td key={d.date} style={numCellStyle(v)}>{v > 0 ? fmt(v) : '·'}</td>
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                }) : (
                  <tr>
                    <td colSpan={5 + rangeDates.length}>
                      <div className="empty-st">
                        <div className="es-ico">🛒</div>
                        <div className="es-t">{salesData.length ? '검색 결과 없음' : '판매 데이터를 업로드해주세요'}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#F3F7FF', fontWeight: 800, borderTop: '2px solid var(--blue)' }}>
                    <td style={{ position: 'sticky', left: 0, background: '#F3F7FF', zIndex: 2 }}></td>
                    <td style={{ position: 'sticky', left: 28, background: '#F3F7FF', zIndex: 2 }}></td>
                    <td style={{ fontWeight: 800, padding: '8px 10px', position: 'sticky', left: 80, background: '#F3F7FF', zIndex: 2, borderRight: '1px solid #DBE4F5' }}>
                      합계 ({filtered.length}개 상품)
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--blue)', padding: '8px 10px' }}>
                      {fmt(mode === 'qty' ? totals.ytdQty : totals.ytdRev)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 10px', borderRight: '2px solid #E4E7EC' }}>
                      {fmt(mode === 'qty' ? totals.weekQty : totals.weekRev)}
                    </td>
                    {totals.rangeDaily.map(d => {
                      const v = mode === 'qty' ? d.qty : d.rev
                      return (
                        <td key={d.date} style={{
                          textAlign: 'right', padding: '8px', fontSize: 12, fontWeight: 800,
                          color: 'var(--blue)', whiteSpace: 'nowrap',
                        }}>{v > 0 ? fmt(v) : '·'}</td>
                      )
                    })}
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

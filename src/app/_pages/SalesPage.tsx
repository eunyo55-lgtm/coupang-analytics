'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useApp } from '@/lib/store'
import { toYMD, fromYMD } from '@/lib/dateUtils'
import { Chart, registerables } from 'chart.js'
import SalesActionBoard from './SalesActionBoard'

Chart.register(...registerables)

// ─── 보조 타입 ───
type Mode = 'qty' | 'rev'

interface ProductAgg {
  productName:  string
  imageUrl:     string
  season:       string
  category:     string
  ytdQty:       number
  ytdRev:       number
  weekQty:      number
  weekRev:      number
  chartDaily:   { date: string; qty: number; rev: number }[]  // 차트 필터 기간
  tableDaily:   { date: string; qty: number; rev: number }[]  // 테이블 필터 기간
  options:      OptionAgg[]
}

interface OptionAgg {
  barcode:    string
  option:     string
  cost:       number
  ytdQty:     number
  ytdRev:     number
  weekQty:    number
  weekRev:    number
  tableDaily: { date: string; qty: number; rev: number }[]
}

// ─── 카테고리 추출 ───
// 상품명의 '-' 앞부분. 단, 영숫자로만 이뤄진 코드 패턴(예: 045P01GIV130)은 '기타'로.
const CODE_PATTERN = /^[A-Za-z0-9._-]+$/  // 영문+숫자+일부기호만 있는 경우
function extractCategory(productName: string): string {
  if (!productName) return '기타'
  const idx = productName.indexOf('-')
  // '-'가 없으면 상품명 전체가 카테고리 후보
  const head = idx > 0 ? productName.slice(0, idx) : productName
  const trimmed = head.trim()
  if (!trimmed) return '기타'
  // 한글이 하나도 없고 영숫자/기호만이면 코드로 간주 → 기타
  const hasKorean = /[\uAC00-\uD7A3]/.test(trimmed)
  if (!hasKorean && CODE_PATTERN.test(trimmed)) return '기타'
  // '-'가 없는 상품 (ex: '장화')은 그대로 인정
  // 다만 너무 긴 문자열(15자 이상)이고 한글도 없으면 기타
  if (!hasKorean && trimmed.length > 15) return '기타'
  return trimmed
}

// ─── 날짜 헤더 포맷 ───
function formatMD(ymd: string): string {
  return ymd.length >= 10 ? ymd.slice(5).replace('-', '/') : ymd
}

function dayColor(ymd: string): string {
  const d = fromYMD(ymd)
  const dow = d.getDay()
  return dow === 0 ? '#F04438' : dow === 6 ? '#1570EF' : 'var(--t2)'
}

// ─── 기간 날짜 배열 생성 유틸 ───
function buildRange(fromYmd: string, toYmd: string): string[] {
  const arr: string[] = []
  const f = fromYMD(fromYmd), t = fromYMD(toYmd)
  const d = new Date(f)
  while (d <= t) {
    arr.push(toYMD(d))
    d.setDate(d.getDate() + 1)
  }
  return arr
}

const PAGE_SIZE = 50

export default function SalesPage() {
  const { state } = useApp()
  const { salesData, latestSaleDate } = state

  // ─── 최근 판매일 앵커 ───
  const todayAnchor = useMemo(() => latestSaleDate || (() => {
    const y = new Date(); y.setHours(0,0,0,0); y.setDate(y.getDate() - 1)
    return toYMD(y)
  })(), [latestSaleDate])

  // ─── 차트 필터 (기본 30일) ───
  const chartDefault = useMemo(() => {
    const anchor = fromYMD(todayAnchor)
    const from = new Date(anchor); from.setDate(from.getDate() - 29)
    return { from: toYMD(from), to: todayAnchor }
  }, [todayAnchor])

  const [chartFrom, setChartFrom] = useState(chartDefault.from)
  const [chartTo,   setChartTo]   = useState(chartDefault.to)

  // ─── 테이블 필터 (기본 7일) ───
  const tableDefault = useMemo(() => {
    const anchor = fromYMD(todayAnchor)
    const from = new Date(anchor); from.setDate(from.getDate() - 6)
    return { from: toYMD(from), to: todayAnchor }
  }, [todayAnchor])

  const [tableFrom, setTableFrom] = useState(tableDefault.from)
  const [tableTo,   setTableTo]   = useState(tableDefault.to)

  useEffect(() => {
    setChartFrom(chartDefault.from); setChartTo(chartDefault.to)
    setTableFrom(tableDefault.from); setTableTo(tableDefault.to)
  }, [chartDefault.from, chartDefault.to, tableDefault.from, tableDefault.to])

  const [mode, setMode] = useState<Mode>('qty')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // 정렬: 'ytd' | 'week' | 날짜 문자열(YYYY-MM-DD) | 'name'
  const [sortKey, setSortKey] = useState<string>('ytd')
  const [sortDesc, setSortDesc] = useState(true)
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDesc(!sortDesc)
    else { setSortKey(key); setSortDesc(true) }
  }
  const sortIcon = (key: string) => sortKey === key ? (sortDesc ? ' ▼' : ' ▲') : ''

  // 주간 고정 (최근 7일)
  const weekFromYMD = useMemo(() => {
    const d = fromYMD(todayAnchor); d.setDate(d.getDate() - 6)
    return toYMD(d)
  }, [todayAnchor])

  const yearStart = `${new Date().getFullYear()}-01-01`

  const chartDates = useMemo(() => buildRange(chartFrom, chartTo), [chartFrom, chartTo])
  const tableDates = useMemo(() => buildRange(tableFrom, tableTo), [tableFrom, tableTo])

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
        tableDaily: Map<string, { qty: number; rev: number }>
      }>
      ytdQty: number; ytdRev: number
      weekQty: number; weekRev: number
      chartDaily: Map<string, { qty: number; rev: number }>
      tableDaily: Map<string, { qty: number; rev: number }>
    }
    const map = new Map<string, ProdBuilder>()

    const emptyMap = (dates: string[]) => new Map(dates.map(d => [d, { qty: 0, rev: 0 }]))

    for (const r of salesData) {
      if (r.isReturn) continue
      const name = r.productName || '—'
      let p = map.get(name)
      if (!p) {
        p = {
          productName: name,
          imageUrl:    r.imageUrl || '',
          season:      r.season || '',
          category:    extractCategory(name),
          optMap:      new Map(),
          ytdQty: 0, ytdRev: 0,
          weekQty: 0, weekRev: 0,
          chartDaily: emptyMap(chartDates),
          tableDaily: emptyMap(tableDates),
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
          tableDaily: emptyMap(tableDates),
        }
        p.optMap.set(optKey, o)
      }

      if (r.date >= yearStart && r.date <= todayAnchor) {
        p.ytdQty += qty; p.ytdRev += rev
        o.ytdQty += qty; o.ytdRev += rev
      }
      if (r.date >= weekFromYMD && r.date <= todayAnchor) {
        p.weekQty += qty; p.weekRev += rev
        o.weekQty += qty; o.weekRev += rev
      }
      // 차트 기간
      if (r.date >= chartFrom && r.date <= chartTo) {
        const s = p.chartDaily.get(r.date)
        if (s) { s.qty += qty; s.rev += rev }
      }
      // 테이블 기간
      if (r.date >= tableFrom && r.date <= tableTo) {
        const s = p.tableDaily.get(r.date)
        if (s) { s.qty += qty; s.rev += rev }
        const os = o.tableDaily.get(r.date)
        if (os) { os.qty += qty; os.rev += rev }
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
          tableDaily: tableDates.map(d => ({
            date: d,
            qty: o.tableDaily.get(d)?.qty || 0,
            rev: o.tableDaily.get(d)?.rev || 0,
          })),
        }))
        .sort((a, b) => b.ytdQty - a.ytdQty)

      const chartDaily = chartDates.map(d => ({
        date: d,
        qty: p.chartDaily.get(d)?.qty || 0,
        rev: p.chartDaily.get(d)?.rev || 0,
      }))
      const tableDaily = tableDates.map(d => ({
        date: d,
        qty: p.tableDaily.get(d)?.qty || 0,
        rev: p.tableDaily.get(d)?.rev || 0,
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
        chartDaily,
        tableDaily,
        options,
      })
    })
    // 정렬은 sorted useMemo에서 처리
    return result
  }, [salesData, chartFrom, chartTo, tableFrom, tableTo, todayAnchor, weekFromYMD, yearStart, chartDates, tableDates])

  // 검색 필터 + 더보기 리셋
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search, tableFrom, tableTo])

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

  // 정렬: sortKey에 따라 판매량/매출 정렬
  const sorted = useMemo(() => {
    const arr = [...filtered]
    const getVal = (p: ProductAgg): number | string => {
      if (sortKey === 'name') return p.productName
      if (sortKey === 'ytd')  return mode === 'qty' ? p.ytdQty  : p.ytdRev
      if (sortKey === 'week') return mode === 'qty' ? p.weekQty : p.weekRev
      // 날짜 키 (YYYY-MM-DD)
      const d = p.tableDaily.find(x => x.date === sortKey)
      if (d) return mode === 'qty' ? d.qty : d.rev
      return 0
    }
    arr.sort((a, b) => {
      const va = getVal(a), vb = getVal(b)
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDesc ? vb - va : va - vb
      }
      return sortDesc
        ? String(vb).localeCompare(String(va), 'ko')
        : String(va).localeCompare(String(vb), 'ko')
    })
    return arr
  }, [filtered, sortKey, sortDesc, mode])

  const visible = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount])

  // 합계 (보이는 상품 기준)
  const totals = useMemo(() => {
    let ytdQty = 0, ytdRev = 0, weekQty = 0, weekRev = 0
    const dailyTotal = new Map<string, { qty: number; rev: number }>(
      tableDates.map(d => [d, { qty: 0, rev: 0 }])
    )
    visible.forEach(p => {
      ytdQty += p.ytdQty; ytdRev += p.ytdRev
      weekQty += p.weekQty; weekRev += p.weekRev
      p.tableDaily.forEach(d => {
        const slot = dailyTotal.get(d.date)
        if (slot) { slot.qty += d.qty; slot.rev += d.rev }
      })
    })
    const rangeDaily = tableDates.map(d => ({
      date: d,
      qty: dailyTotal.get(d)?.qty || 0,
      rev: dailyTotal.get(d)?.rev || 0,
    }))
    return { ytdQty, ytdRev, weekQty, weekRev, rangeDaily }
  }, [visible, tableDates])

  // ─── 차트용 시즌별 / 카테고리별 ───
  const bySeason = useMemo(() => {
    const m = new Map<string, { qty: number; rev: number }>()
    products.forEach(p => {
      const key = p.season || '미지정'
      const cur = m.get(key) || { qty: 0, rev: 0 }
      p.chartDaily.forEach(d => { cur.qty += d.qty; cur.rev += d.rev })
      m.set(key, cur)
    })
    return Array.from(m.entries())
      .map(([k, v]) => ({ label: k, ...v }))
      .filter(s => (mode === 'qty' ? s.qty : s.rev) > 0)
      .sort((a, b) => (mode === 'qty' ? b.qty - a.qty : b.rev - a.rev))
  }, [products, mode])

  const byCategory = useMemo(() => {
    const m = new Map<string, { qty: number; rev: number }>()
    products.forEach(p => {
      const key = p.category || '기타'
      const cur = m.get(key) || { qty: 0, rev: 0 }
      p.chartDaily.forEach(d => { cur.qty += d.qty; cur.rev += d.rev })
      m.set(key, cur)
    })
    // 정렬 후, '기타'는 항상 맨 뒤로 보냄
    const arr = Array.from(m.entries())
      .map(([k, v]) => ({ label: k, ...v }))
      .filter(c => (mode === 'qty' ? c.qty : c.rev) > 0)
      .sort((a, b) => (mode === 'qty' ? b.qty - a.qty : b.rev - a.rev))
    const others = arr.filter(x => x.label === '기타')
    const rest   = arr.filter(x => x.label !== '기타')
    return [...rest, ...others]
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
          backgroundColor: byCategory.map(s => s.label === '기타' ? '#98A2B3' : '#1570EF'),
          borderRadius: 6,
          // barThickness 제거 → 자동 폭 사용으로 공간 더 잘 활용
          maxBarThickness: 48,
          categoryPercentage: 0.85,
          barPercentage: 0.9,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 12, bottom: 0, left: 4, right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ' ' + Number(ctx.parsed.y).toLocaleString('ko-KR') } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' as const }, color: '#56606E', autoSkip: false, maxRotation: 45, minRotation: 45 } },
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
    minWidth: 54,
  })

  return (
    <div>
      {/* ─── 공통 모드 토글 + 차트 필터 ─── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cb" style={{ padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>📊 차트 기간</span>
            <input type="date" className="date-input" value={chartFrom} onChange={e => setChartFrom(e.target.value)} />
            <span className="date-range-sep">~</span>
            <input type="date" className="date-input" value={chartTo} onChange={e => setChartTo(e.target.value)} />
          </div>
          <span className="date-label-txt" style={{ fontSize: 11, color: 'var(--t3)' }}>
            {chartDates.length}일 · 최근 판매일 {todayAnchor || '—'}
          </span>
          <div style={{ flex: 1 }} />
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

      {/* ─── 판매 & 랭킹 액션 보드 ─── */}
      <SalesActionBoard
        products={products.map(p => ({
          productName: p.productName,
          imageUrl: p.imageUrl,
          category: p.category,
          season: p.season,
          ytdQty: p.ytdQty,
          chartDaily: p.chartDaily,
        }))}
        rankings={state.rankings}
        anchorDate={chartTo}
      />

      {/* ─── 시즌별 / 카테고리별 차트 ─── */}
      <div className="g2">
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🗓️</div><div>
              <div className="ch-title">시즌별 판매 ({mode === 'qty' ? '수량' : '금액'})</div>
              <div className="ch-sub">{chartFrom} ~ {chartTo}</div>
            </div></div>
          </div>
          <div className="cb">
            {bySeason.length > 0
              ? <div style={{ position: 'relative', height: 260 }}><canvas ref={seasonRef} /></div>
              : <div className="empty-st"><div className="es-ico">🗓️</div><div className="es-t">기간 내 시즌 데이터가 없어요</div></div>
            }
          </div>
        </div>
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">📦</div><div>
              <div className="ch-title">카테고리별 판매 ({mode === 'qty' ? '수량' : '금액'})</div>
              <div className="ch-sub">상품명 앞부분 기준 · 매칭 안되면 &apos;기타&apos; · {chartFrom} ~ {chartTo}</div>
            </div></div>
          </div>
          <div className="cb">
            {byCategory.length > 0
              ? <div style={{ position: 'relative', height: 320 }}><canvas ref={catRef} /></div>
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
            <div className="ch-sub">상품명 클릭 → 옵션별 펼치기 · 50개씩 보기</div>
          </div></div>
          {/* 헤더 우측의 테이블 기간 필터 */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>📅 기간</span>
            <input type="date" className="date-input" value={tableFrom} onChange={e => setTableFrom(e.target.value)} />
            <span className="date-range-sep">~</span>
            <input type="date" className="date-input" value={tableTo} onChange={e => setTableTo(e.target.value)} />
            <span className="date-label-txt" style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 4 }}>
              {tableDates.length}일
            </span>
          </div>
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
                  <th
                    onClick={() => toggleSort('name')}
                    style={{
                      minWidth: 130, textAlign: 'left', padding: '8px 10px',
                      position: 'sticky', left: 80, background: '#F9FAFB', zIndex: 4,
                      borderBottom: '1px solid #E4E7EC', fontSize: 12, cursor: 'pointer',
                    }}
                  >상품명{sortIcon('name')}</th>
                  <th
                    onClick={() => toggleSort('ytd')}
                    style={{
                      width: 90, textAlign: 'right', padding: '8px 10px', background: '#F9FAFB',
                      borderBottom: '1px solid #E4E7EC', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    누적{sortIcon('ytd')}
                    <div style={{ fontWeight: 500, color: 'var(--t3)', fontSize: 10 }}>1/1~{todayAnchor.slice(5)}</div>
                  </th>
                  <th
                    onClick={() => toggleSort('week')}
                    style={{
                      width: 80, textAlign: 'right', padding: '8px 10px', background: '#F9FAFB',
                      borderBottom: '1px solid #E4E7EC', fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    주간{sortIcon('week')}
                    <div style={{ fontWeight: 500, color: 'var(--t3)', fontSize: 10 }}>최근 7일</div>
                  </th>
                  {tableDates.map(d => (
                    <th
                      key={d}
                      onClick={() => toggleSort(d)}
                      style={{ ...dateHeaderStyle(d), cursor: 'pointer' }}
                    >{formatMD(d)}{sortIcon(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length > 0 ? visible.map((p) => {
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
                          <div style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.productName}</div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                            {p.category && <span className="badge b-gr" style={{ fontSize: 10 }}>{p.category}</span>}
                            {p.season   && <span className="badge b-bl" style={{ fontSize: 10 }}>{p.season}</span>}
                            <span style={{ fontSize: 10, color: 'var(--t3)' }}>옵션 {p.options.length}개</span>
                          </div>
                        </td>
                        <td style={{ fontWeight: 800, color: 'var(--blue)', textAlign: 'right', padding: '6px 10px' }}>
                          {fmt(mode === 'qty' ? p.ytdQty : p.ytdRev)}
                        </td>
                        <td style={{ fontWeight: 700, textAlign: 'right', padding: '6px 10px' }}>
                          {fmt(mode === 'qty' ? p.weekQty : p.weekRev)}
                        </td>
                        {p.tableDaily.map(d => {
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
                          <td style={{ textAlign: 'right', fontSize: 12, padding: '6px 10px' }}>
                            {fmt(mode === 'qty' ? o.weekQty : o.weekRev)}
                          </td>
                          {o.tableDaily.map(d => {
                            const v = mode === 'qty' ? d.qty : d.rev
                            return <td key={d.date} style={numCellStyle(v)}>{v > 0 ? fmt(v) : '·'}</td>
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                }) : (
                  <tr>
                    <td colSpan={5 + tableDates.length}>
                      <div className="empty-st">
                        <div className="es-ico">🛒</div>
                        <div className="es-t">{salesData.length ? '검색 결과 없음' : '판매 데이터를 업로드해주세요'}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              {visible.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#F3F7FF', fontWeight: 800, borderTop: '2px solid var(--blue)' }}>
                    <td style={{ position: 'sticky', left: 0, background: '#F3F7FF', zIndex: 2 }}></td>
                    <td style={{ position: 'sticky', left: 28, background: '#F3F7FF', zIndex: 2 }}></td>
                    <td style={{ fontWeight: 800, padding: '8px 10px', position: 'sticky', left: 80, background: '#F3F7FF', zIndex: 2, borderRight: '1px solid #DBE4F5' }}>
                      합계 ({visible.length}개 표시)
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--blue)', padding: '8px 10px' }}>
                      {fmt(mode === 'qty' ? totals.ytdQty : totals.ytdRev)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 10px' }}>
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

          {/* 더 보기 */}
          {sorted.length > visibleCount && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 4px' }}>
              <button
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                style={{
                  padding: '10px 20px', fontSize: 13, fontWeight: 800,
                  background: '#fff', color: 'var(--blue)',
                  border: '1.5px solid var(--blue)', borderRadius: 8, cursor: 'pointer',
                }}
              >
                더 보기 ({visibleCount.toLocaleString()} / {sorted.length.toLocaleString()})
              </button>
            </div>
          )}
          {sorted.length > 0 && sorted.length <= visibleCount && (
            <div style={{ textAlign: 'center', padding: '14px 0 4px', fontSize: 11, color: 'var(--t3)' }}>
              전체 {sorted.length.toLocaleString()}개 상품 모두 표시됨
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

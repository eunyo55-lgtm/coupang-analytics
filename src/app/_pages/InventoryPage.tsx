'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/store'
import { toYMD } from '@/lib/dateUtils'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI'

async function rpc(fn: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (data?.code) { console.warn('[inventory RPC]', fn, data.message); return [] }
  return Array.isArray(data) ? data : []
}

type SummaryRow = {
  name: string
  image_url: string
  season: string
  category: string
  option_count: number
  cost_avg: number
  coupang_cost_avg: number
  hq_stock: number
  coupang_stock: number
  supply_qty: number
  daily_sales: number
  days_left: number | null
  total_qty_range: number
  stock_value_master: number
  stock_value_coupang: number
}

type OptionRow = {
  barcode: string
  option_value: string
  cost: number
  coupang_cost: number
  hq_stock: number
  coupang_stock: number
  supply_qty: number
  daily_sales: number
  days_left: number | null
}

// 카테고리 자동 추출 (판매현황과 동일 로직)
const CODE_PATTERN = /^[A-Za-z0-9._-]+$/
function extractCategory(productName: string): string {
  if (!productName) return '기타'
  const idx = productName.indexOf('-')
  const head = idx > 0 ? productName.slice(0, idx) : productName
  const trimmed = head.trim()
  if (!trimmed) return '기타'
  const hasKorean = /[\uAC00-\uD7A3]/.test(trimmed)
  if (!hasKorean && CODE_PATTERN.test(trimmed)) return '기타'
  if (!hasKorean && trimmed.length > 15) return '기타'
  return trimmed
}

const SEASON_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#6B7280', '#EC4899']
const CAT_COLOR = '#3B82F6'
const PAGE_SIZE = 50

export default function InventoryPage() {
  const { state } = useApp()
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const fmtMoney = (n: number) => {
    if (n >= 100_000_000) return (Math.round(n / 10_000_000) / 10).toLocaleString('ko-KR') + '억'
    if (n >= 10_000) return (Math.round(n / 1000) / 10).toLocaleString('ko-KR') + '만'
    return Math.round(n).toLocaleString('ko-KR')
  }

  const defaultTo = state.latestSaleDate || toYMD(new Date(Date.now() - 86400000))
  const defaultFrom = useMemo(() => {
    const d = new Date(defaultTo); d.setDate(d.getDate() - 6); return toYMD(d)
  }, [defaultTo])

  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [search, setSearch] = useState('')
  const [deadFrom, setDeadFrom] = useState(defaultFrom)
  const [deadTo, setDeadTo] = useState(defaultTo)
  const [deadSeason, setDeadSeason] = useState('전체')
  const [viewMode, setViewMode] = useState<'qty' | 'amt'>('qty')
  const [costSource, setCostSource] = useState<'master' | 'coupang'>('coupang')
  const [sortBy, setSortBy] = useState<string>('daily_sales')
  const [sortDesc, setSortDesc] = useState(true)
  const [page, setPage] = useState(1)

  const [summaries, setSummaries] = useState<SummaryRow[]>([])
  const [deadSummaries, setDeadSummaries] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [optionsCache, setOptionsCache] = useState<Record<string, OptionRow[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (state.latestSaleDate) {
      setTo(state.latestSaleDate)
      setDeadTo(state.latestSaleDate)
      const d = new Date(state.latestSaleDate); d.setDate(d.getDate() - 6)
      setFrom(toYMD(d))
      setDeadFrom(toYMD(d))
    }
  }, [state.latestSaleDate])

  const normalizeSummary = (r: SummaryRow): SummaryRow => ({
    ...r,
    hq_stock: Number(r.hq_stock || 0),
    coupang_stock: Number(r.coupang_stock || 0),
    supply_qty: Number(r.supply_qty || 0),
    cost_avg: Number(r.cost_avg || 0),
    coupang_cost_avg: Number(r.coupang_cost_avg || 0),
    daily_sales: Number(r.daily_sales || 0),
    days_left: r.days_left == null ? null : Number(r.days_left),
    total_qty_range: Number(r.total_qty_range || 0),
    stock_value_master: Number(r.stock_value_master || 0),
    stock_value_coupang: Number(r.stock_value_coupang || 0),
    option_count: Number(r.option_count || 0),
    season: r.season && r.season.trim() ? r.season : '미지정',
    category: extractCategory(r.name),
  })

  useEffect(() => {
    if (!from || !to) return
    setLoading(true)
    rpc('get_inventory_summary', { p_from: from, p_to: to })
      .then((data) => {
        setSummaries((data as SummaryRow[]).map(normalizeSummary))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [from, to])

  useEffect(() => {
    if (!deadFrom || !deadTo) return
    if (deadFrom === from && deadTo === to) {
      setDeadSummaries([])
      return
    }
    rpc('get_inventory_summary', { p_from: deadFrom, p_to: deadTo })
      .then((data) => setDeadSummaries((data as SummaryRow[]).map(normalizeSummary)))
      .catch(() => {})
  }, [deadFrom, deadTo, from, to])

  const priceOfSummary = (r: SummaryRow): number => {
    if (costSource === 'master') return r.cost_avg > 0 ? r.cost_avg : r.coupang_cost_avg
    return r.coupang_cost_avg > 0 ? r.coupang_cost_avg : r.cost_avg
  }
  const stockValueOf = (r: SummaryRow): number =>
    costSource === 'master'
      ? (r.stock_value_master > 0 ? r.stock_value_master : r.stock_value_coupang)
      : (r.stock_value_coupang > 0 ? r.stock_value_coupang : r.stock_value_master)
  const priceOfOption = (o: OptionRow): number => {
    if (costSource === 'master') return o.cost > 0 ? o.cost : o.coupang_cost
    return o.coupang_cost > 0 ? o.coupang_cost : o.cost
  }

  const filtered = useMemo(() => {
    if (!search) return summaries
    const s = search.toLowerCase()
    return summaries.filter(r => (r.name + r.season + r.category).toLowerCase().includes(s))
  }, [summaries, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const getVal = (r: SummaryRow): number | string => {
      switch (sortBy) {
        case 'name':          return r.name
        case 'hq_stock':      return r.hq_stock
        case 'coupang_stock': return r.coupang_stock
        case 'supply_qty':    return r.supply_qty
        case 'daily_sales':   return r.daily_sales
        case 'days_left':     return r.days_left ?? 99999
        default:              return r.daily_sales
      }
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
  }, [filtered, sortBy, sortDesc])

  const pagedSummaries = sorted.slice(0, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [from, to, search, sortBy, sortDesc, viewMode, costSource])

  const seasonChart = useMemo(() => {
    const map = new Map<string, { qty: number; value: number }>()
    summaries.forEach(r => {
      const s = r.season || '미지정'
      const qty = r.hq_stock + r.coupang_stock
      const value = stockValueOf(r)
      const cur = map.get(s) || { qty: 0, value: 0 }
      cur.qty += qty
      cur.value += value
      map.set(s, cur)
    })
    return Array.from(map.entries())
      .map(([k, v]) => ({ name: k, value: viewMode === 'qty' ? v.qty : v.value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [summaries, viewMode, costSource])

  const categoryChart = useMemo(() => {
    const map = new Map<string, { qty: number; value: number }>()
    summaries.forEach(r => {
      const c = r.category || '기타'
      const cur = map.get(c) || { qty: 0, value: 0 }
      cur.qty += r.total_qty_range
      cur.value += r.total_qty_range * priceOfSummary(r)
      map.set(c, cur)
    })
    return Array.from(map.entries())
      .map(([k, v]) => ({ category: k, value: viewMode === 'qty' ? v.qty : v.value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
  }, [summaries, viewMode, costSource])

  // 미운동 재고용 시즌 옵션 (deadSummaries 또는 summaries 기반)
  const deadSeasonOptions = useMemo(() => {
    const set = new Set<string>()
    const src = deadSummaries.length > 0 ? deadSummaries : summaries
    src.forEach(r => set.add(r.season || '미지정'))
    return ['전체', ...Array.from(set).sort()]
  }, [deadSummaries, summaries])

  const deadStock = useMemo(() => {
    const source = deadSummaries.length > 0
      ? (search
          ? deadSummaries.filter(r => (r.name + r.season + r.category).toLowerCase().includes(search.toLowerCase()))
          : deadSummaries)
      : filtered
    return source
      // 쿠팡재고 기준: 기간 내 판매 0 & 쿠팡재고 > 0
      .filter(r => r.total_qty_range === 0 && r.coupang_stock > 0)
      // 시즌 필터
      .filter(r => deadSeason === '전체' || (r.season || '미지정') === deadSeason)
      .map(r => ({
        ...r,
        total_stock: r.coupang_stock,   // 쿠팡 재고만 표시
        stock_value: r.coupang_stock * (costSource === 'master'
          ? (r.cost_avg > 0 ? r.cost_avg : r.coupang_cost_avg)
          : (r.coupang_cost_avg > 0 ? r.coupang_cost_avg : r.cost_avg)),
      }))
      .sort((a, b) => viewMode === 'qty'
        ? b.total_stock - a.total_stock
        : b.stock_value - a.stock_value)
  }, [deadSummaries, filtered, search, viewMode, costSource, deadSeason])

  const deadStockTotal = useMemo(() =>
    deadStock.reduce((s, d) => s + (viewMode === 'qty' ? d.total_stock : d.stock_value), 0),
  [deadStock, viewMode])

  const toggleExpand = async (name: string) => {
    const s = new Set(expanded)
    if (s.has(name)) {
      s.delete(name); setExpanded(s); return
    }
    s.add(name); setExpanded(s)
    const cacheKey = `${name}||${from}||${to}`
    if (optionsCache[cacheKey]) return
    const data = await rpc('get_inventory_options', { p_name: name, p_from: from, p_to: to })
    const opts = (data as OptionRow[]).map(o => ({
      ...o,
      cost: Number(o.cost || 0),
      coupang_cost: Number(o.coupang_cost || 0),
      hq_stock: Number(o.hq_stock || 0),
      coupang_stock: Number(o.coupang_stock || 0),
      supply_qty: Number(o.supply_qty || 0),
      daily_sales: Number(o.daily_sales || 0),
      days_left: o.days_left == null ? null : Number(o.days_left),
    }))
    setOptionsCache(c => ({ ...c, [cacheKey]: opts }))
  }

  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDesc(!sortDesc)
    else { setSortBy(key); setSortDesc(true) }
  }

  const valueForSummary = (qty: number, r: SummaryRow) =>
    viewMode === 'qty' ? fmt(qty) : fmtMoney(qty * priceOfSummary(r))
  const valueForOption = (qty: number, o: OptionRow) =>
    viewMode === 'qty' ? fmt(qty) : fmtMoney(qty * priceOfOption(o))

  return (
    <div>
      {/* 필터 바 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cb" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>📅 기간</span>
            <input type="date" className="date-input" value={from} onChange={e => setFrom(e.target.value)} />
            <span className="date-range-sep">~</span>
            <input type="date" className="date-input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #E4E7EC' }}>
              <button onClick={() => setViewMode('qty')}
                style={{ padding: '8px 14px', fontSize: 12, fontWeight: 800, border: 'none', cursor: 'pointer',
                  background: viewMode === 'qty' ? 'var(--blue)' : '#fff',
                  color: viewMode === 'qty' ? '#fff' : 'var(--t2)' }}>수량 보기</button>
              <button onClick={() => setViewMode('amt')}
                style={{ padding: '8px 14px', fontSize: 12, fontWeight: 800, border: 'none', cursor: 'pointer',
                  background: viewMode === 'amt' ? 'var(--blue)' : '#fff',
                  color: viewMode === 'amt' ? '#fff' : 'var(--t2)' }}>금액 보기</button>
            </div>
            {viewMode === 'amt' && (
              <>
                <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
                <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>원가</span>
                <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #E4E7EC' }}>
                  <button onClick={() => setCostSource('master')}
                    style={{ padding: '7px 12px', fontSize: 11, fontWeight: 800, border: 'none', cursor: 'pointer',
                      background: costSource === 'master' ? 'var(--purple)' : '#fff',
                      color: costSource === 'master' ? '#fff' : 'var(--t2)' }}>마스터</button>
                  <button onClick={() => setCostSource('coupang')}
                    style={{ padding: '7px 12px', fontSize: 11, fontWeight: 800, border: 'none', cursor: 'pointer',
                      background: costSource === 'coupang' ? 'var(--purple)' : '#fff',
                      color: costSource === 'coupang' ? '#fff' : 'var(--t2)' }}>쿠팡</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 시즌 파이 + 카테고리 막대 */}
      <div className="g2" style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🎨</div>
              <div><div className="ch-title">시즌별 재고 비중</div>
                <div className="ch-sub">본사+쿠팡 재고 합계 기준 ({viewMode === 'qty' ? '수량' : '금액'})</div></div>
            </div>
          </div>
          <div className="cb">
            {seasonChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={seasonChart} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={85}
                    label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                    labelLine={false}>
                    {seasonChart.map((_, i) => <Cell key={i} fill={SEASON_COLORS[i % SEASON_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => viewMode === 'qty' ? fmt(v) + '개' : fmtMoney(v) + '원'} />
                  <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-st" style={{ height: 260 }}>
                <div className="es-ico">🎨</div><div className="es-t">{loading ? '불러오는 중...' : '시즌 데이터 없음'}</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">📊</div>
              <div><div className="ch-title">카테고리별 판매 비중</div>
                <div className="ch-sub">{from} ~ {to} ({viewMode === 'qty' ? '수량' : '금액'})</div></div>
            </div>
          </div>
          <div className="cb">
            {categoryChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={categoryChart} margin={{ top: 12, right: 16, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={70} />
                  <YAxis tick={{ fontSize: 10 }} width={50}
                    tickFormatter={v => viewMode === 'qty' ? fmt(v) : fmtMoney(v)} />
                  <Tooltip formatter={(v: number) => viewMode === 'qty' ? fmt(v) + '개' : fmtMoney(v) + '원'} />
                  <Bar dataKey="value" fill={CAT_COLOR} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-st" style={{ height: 260 }}>
                <div className="es-ico">📊</div><div className="es-t">{loading ? '불러오는 중...' : '판매 데이터 없음'}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 미운동 재고 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">💤</div>
            <div><div className="ch-title">미운동 재고</div>
              <div className="ch-sub">{deadFrom} ~ {deadTo} 기간 판매 0 · 재고 보유 {deadStock.length}개 상품
                {viewMode === 'qty' ? ` · 총 ${fmt(deadStockTotal)}개` : ` · 총 ${fmtMoney(deadStockTotal)}원`}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>🎨 시즌</span>
            <select value={deadSeason} onChange={e => setDeadSeason(e.target.value)}
              style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }}>
              {deadSeasonOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginLeft: 6 }}>📅 기간</span>
            <input type="date" className="date-input" value={deadFrom} onChange={e => setDeadFrom(e.target.value)} />
            <span className="date-range-sep">~</span>
            <input type="date" className="date-input" value={deadTo} onChange={e => setDeadTo(e.target.value)} />
          </div>
        </div>
        <div className="cb">
          <div className="tw" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {deadStock.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>이미지</th>
                    <th style={{ width: 180 }}>상품명</th>
                    <th>시즌</th>
                    <th>카테고리</th>
                    <th style={{ textAlign: 'right' }}>본사재고</th>
                    <th style={{ textAlign: 'right' }}>쿠팡재고</th>
                    <th style={{ textAlign: 'right' }}>{viewMode === 'qty' ? '총재고' : '재고액'}</th>
                  </tr>
                </thead>
                <tbody>
                  {deadStock.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td>{r.image_url
                        ? <img src={r.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        : <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>-</div>}
                      </td>
                      <td style={{ fontWeight: 700, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td style={{ fontSize: 11 }}>{r.season}</td>
                      <td style={{ fontSize: 11 }}>{r.category}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.hq_stock)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.coupang_stock)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--amber)' }}>
                        {viewMode === 'qty' ? fmt(r.total_stock) : fmtMoney(r.stock_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-st"><div className="es-ico">✨</div>
                <div className="es-t">해당 기간에 모든 재고가 판매되었거나 데이터가 없습니다</div></div>
            )}
          </div>
        </div>
      </div>

      {/* 메인 재고 테이블 */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📦</div>
            <div><div className="ch-title">재고 현황</div>
              <div className="ch-sub">전일 기준 일평균 기준 · 상품명 클릭 시 옵션 펼치기</div></div>
          </div>
        </div>
        <div className="cb">
          <div className="frow" style={{ marginBottom: 8 }}>
            <input className="si" placeholder="🔍 상품명 · 시즌 · 카테고리 검색..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {loading ? (
            <div className="empty-st"><div className="es-ico">⏳</div><div className="es-t">불러오는 중...</div></div>
          ) : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>이미지</th>
                    <th style={{ width: 180, cursor: 'pointer' }} onClick={() => toggleSort('name')}>상품명 {sortBy === 'name' ? (sortDesc ? '▼' : '▲') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('hq_stock')}>본사재고 {sortBy === 'hq_stock' ? (sortDesc ? '▼' : '▲') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('coupang_stock')}>쿠팡재고 {sortBy === 'coupang_stock' ? (sortDesc ? '▼' : '▲') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('supply_qty')}>공급중 {sortBy === 'supply_qty' ? (sortDesc ? '▼' : '▲') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('daily_sales')}>일평균판매 {sortBy === 'daily_sales' ? (sortDesc ? '▼' : '▲') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('days_left')}>소진예상 {sortBy === 'days_left' ? (sortDesc ? '▼' : '▲') : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSummaries.length > 0 ? pagedSummaries.flatMap(g => {
                    const isOpen = expanded.has(g.name)
                    const cacheKey = `${g.name}||${from}||${to}`
                    const options = optionsCache[cacheKey]
                    const mainRow = (
                      <tr key={g.name} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(g.name)}>
                        <td>{g.image_url
                          ? <img src={g.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>-</div>}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color: 'var(--t3)', fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>
                            <div style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                            {g.category && <span className="badge b-gr" style={{ fontSize: 10 }}>{g.category}</span>}
                            {g.season   && <span className="badge b-bl" style={{ fontSize: 10 }}>{g.season}</span>}
                            <span style={{ fontSize: 10, color: 'var(--t3)' }}>옵션 {g.option_count}개</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{valueForSummary(g.hq_stock, g)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{valueForSummary(g.coupang_stock, g)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--purple)' }}>{valueForSummary(g.supply_qty, g)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {viewMode === 'qty' ? g.daily_sales.toFixed(1) : fmtMoney(g.daily_sales * priceOfSummary(g))}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800,
                          color: g.days_left == null ? 'var(--t3)' : g.days_left < 7 ? 'var(--red)' : g.days_left < 14 ? 'var(--amber)' : 'var(--green)' }}>
                          {g.days_left == null ? '—' : `${fmt(g.days_left)}일`}
                        </td>
                      </tr>
                    )
                    if (!isOpen) return [mainRow]
                    if (!options) {
                      return [mainRow, (
                        <tr key={g.name + '__loading'} style={{ background: 'var(--bg)' }}>
                          <td colSpan={7} style={{ textAlign: 'center', fontSize: 11, color: 'var(--t3)', padding: '8px' }}>
                            ⏳ 옵션 불러오는 중...
                          </td>
                        </tr>
                      )]
                    }
                    const optionRows = options.map(o => (
                      <tr key={g.name + '_' + o.barcode} style={{ background: 'var(--bg)' }}>
                        <td></td>
                        <td style={{ paddingLeft: 28, fontSize: 11, color: 'var(--t2)' }}>
                          └ {o.option_value || '(옵션 없음)'} <span style={{ color: 'var(--t3)', fontSize: 10 }}>· {o.barcode}</span>
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{valueForOption(o.hq_stock, o)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{valueForOption(o.coupang_stock, o)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--purple)' }}>{valueForOption(o.supply_qty, o)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>
                          {viewMode === 'qty' ? o.daily_sales.toFixed(1) : fmtMoney(o.daily_sales * priceOfOption(o))}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 700,
                          color: o.days_left == null ? 'var(--t3)' : o.days_left < 7 ? 'var(--red)' : o.days_left < 14 ? 'var(--amber)' : 'var(--green)' }}>
                          {o.days_left == null ? '—' : `${fmt(o.days_left)}일`}
                        </td>
                      </tr>
                    ))
                    return [mainRow, ...optionRows]
                  }) : (
                    <tr><td colSpan={7}>
                      <div className="empty-st"><div className="es-ico">📦</div>
                        <div className="es-t">조건에 해당하는 상품이 없습니다</div></div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {pagedSummaries.length > 0 && pagedSummaries.length < sorted.length && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <button onClick={() => setPage(p => p + 1)}
                style={{ fontSize: 12, padding: '8px 20px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontWeight: 700 }}>
                더 보기 ({pagedSummaries.length} / {sorted.length})
              </button>
            </div>
          )}
          {pagedSummaries.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--t3)', textAlign: 'center', marginTop: 8 }}>
              전체 {fmt(sorted.length)}개 상품
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

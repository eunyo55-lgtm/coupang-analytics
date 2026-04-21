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
  return data
}

type InventoryRow = {
  barcode: string
  name: string
  option_value: string
  season: string
  category: string
  image_url: string
  cost: number          // 상품마스터 원가
  coupang_cost: number  // 쿠팡 매입가
  hq_stock: number
  coupang_stock: number
  supply_qty: number
  daily_sales: number
  days_left: number | null
  total_qty_range: number
}

// 카테고리 자동 추출: 상품명 맨 앞 - 전까지. 영숫자만이면 '기타'
function extractCategory(name: string): string {
  if (!name) return '기타'
  const idx = name.indexOf('-')
  const head = (idx > 0 ? name.slice(0, idx) : name).trim()
  if (!head || /^[A-Za-z0-9_]+$/.test(head)) return '기타'
  return head
}

const SEASON_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#6B7280', '#EC4899']
const CAT_COLOR = '#3B82F6'

export default function InventoryPage() {
  const { state } = useApp()
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const fmtMoney = (n: number) => {
    if (n >= 100_000_000) return (Math.round(n / 10_000_000) / 10).toLocaleString('ko-KR') + '억'
    if (n >= 10_000) return (Math.round(n / 1000) / 10).toLocaleString('ko-KR') + '만'
    return Math.round(n).toLocaleString('ko-KR')
  }

  // ── 필터 state ──
  const defaultTo = state.latestSaleDate || toYMD(new Date(Date.now() - 86400000))
  const defaultFrom = useMemo(() => {
    const d = new Date(defaultTo); d.setDate(d.getDate() - 6); return toYMD(d)
  }, [defaultTo])

  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [category, setCategory] = useState('전체')
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'qty' | 'amt'>('qty')
  const [costSource, setCostSource] = useState<'master' | 'coupang'>('coupang')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState<string>('daily_sales')
  const [sortDesc, setSortDesc] = useState(true)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => {
    if (state.latestSaleDate) {
      setTo(state.latestSaleDate)
      const d = new Date(state.latestSaleDate); d.setDate(d.getDate() - 6)
      setFrom(toYMD(d))
    }
  }, [state.latestSaleDate])

  // ── 데이터 로드 ──
  useEffect(() => {
    if (!from || !to) return
    setLoading(true)
    rpc('get_inventory_detail', { p_from: from, p_to: to })
      .then((data: unknown) => {
        const arr = Array.isArray(data) ? (data as InventoryRow[]) : []
        setRows(arr.map(r => ({
          ...r,
          coupang_stock: Number(r.coupang_stock || 0),
          supply_qty:    Number(r.supply_qty || 0),
          hq_stock:      Number(r.hq_stock || 0),
          cost:          Number(r.cost || 0),
          coupang_cost:  Number(r.coupang_cost || 0),
          daily_sales:   Number(r.daily_sales || 0),
          total_qty_range: Number(r.total_qty_range || 0),
          days_left:     r.days_left == null ? null : Number(r.days_left),
          category:      r.category && r.category.trim() ? r.category : extractCategory(r.name),
          season:        r.season && r.season.trim() ? r.season : '미지정',
        })))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [from, to])

  // ── 원가 선택 헬퍼 ──
  // costSource에 따라 master 원가 또는 쿠팡 매입가 반환
  // master가 0이면 쿠팡 매입가로 폴백 (그 반대도 마찬가지)
  const priceOf = (r: InventoryRow) => {
    if (costSource === 'master') return r.cost > 0 ? r.cost : r.coupang_cost
    return r.coupang_cost > 0 ? r.coupang_cost : r.cost
  }

  // ── 카테고리 옵션 목록 ──
  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    rows.forEach(r => set.add(r.category || '기타'))
    return ['전체', ...Array.from(set).sort()]
  }, [rows])

  // ── 검색/카테고리 필터 적용 ──
  const filtered = useMemo(() => {
    return rows.filter(r => {
      const matchCat = category === '전체' || r.category === category
      const matchSearch = !search ||
        (r.name + r.option_value + r.barcode + r.season + r.category)
          .toLowerCase().includes(search.toLowerCase())
      return matchCat && matchSearch
    })
  }, [rows, category, search])

  // ── 상품명 기준 그룹핑 ──
  type ProductGroup = {
    name: string
    image_url: string
    options: InventoryRow[]
    hq_stock_sum: number
    coupang_stock_sum: number
    supply_qty_sum: number
    daily_sales_sum: number
    total_qty_sum: number
    cost_avg: number
    category: string
    season: string
    days_left_min: number | null
  }

  const grouped = useMemo<ProductGroup[]>(() => {
    const map = new Map<string, ProductGroup>()
    filtered.forEach(r => {
      const g = map.get(r.name)
      if (g) {
        g.options.push(r)
        g.hq_stock_sum      += r.hq_stock
        g.coupang_stock_sum += r.coupang_stock
        g.supply_qty_sum    += r.supply_qty
        g.daily_sales_sum   += r.daily_sales
        g.total_qty_sum     += r.total_qty_range
        if (r.days_left != null) {
          g.days_left_min = g.days_left_min == null
            ? r.days_left
            : Math.min(g.days_left_min, r.days_left)
        }
      } else {
        map.set(r.name, {
          name: r.name,
          image_url: r.image_url,
          options: [r],
          hq_stock_sum: r.hq_stock,
          coupang_stock_sum: r.coupang_stock,
          supply_qty_sum: r.supply_qty,
          daily_sales_sum: r.daily_sales,
          total_qty_sum: r.total_qty_range,
          cost_avg: priceOf(r),
          category: r.category,
          season: r.season,
          days_left_min: r.days_left,
        })
      }
    })
    return Array.from(map.values()).map(g => ({
      ...g,
      cost_avg: g.options.length
        ? g.options.reduce((s, o) => s + priceOf(o), 0) / g.options.length
        : 0,
    }))
  }, [filtered, costSource])

  // ── 정렬 ──
  const sortedGroups = useMemo(() => {
    const arr = [...grouped]
    const keyMap: Record<string, (g: ProductGroup) => number | string> = {
      name: g => g.name,
      coupang_stock: g => g.coupang_stock_sum,
      hq_stock: g => g.hq_stock_sum,
      supply_qty: g => g.supply_qty_sum,
      daily_sales: g => g.daily_sales_sum,
      days_left: g => g.days_left_min ?? 99999,
    }
    const keyFn = keyMap[sortBy] || keyMap.daily_sales
    arr.sort((a, b) => {
      const va = keyFn(a), vb = keyFn(b)
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDesc ? vb - va : va - vb
      }
      return sortDesc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb))
    })
    return arr
  }, [grouped, sortBy, sortDesc])

  const totalPages = Math.max(1, Math.ceil(sortedGroups.length / PAGE_SIZE))
  const pagedGroups = sortedGroups.slice(0, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [from, to, category, search, sortBy, sortDesc, viewMode])

  // ── 시즌별 재고 비중 ──
  const seasonChart = useMemo(() => {
    const map = new Map<string, { qty: number; value: number }>()
    rows.forEach(r => {
      const s = r.season || '미지정'
      const total = r.hq_stock + r.coupang_stock
      const cur = map.get(s) || { qty: 0, value: 0 }
      cur.qty   += total
      cur.value += total * priceOf(r)
      map.set(s, cur)
    })
    return Array.from(map.entries())
      .map(([k, v]) => ({ name: k, value: viewMode === 'qty' ? v.qty : v.value, qty: v.qty, amt: v.value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [rows, viewMode, costSource])

  // ── 카테고리별 판매 비중 ──
  const categoryChart = useMemo(() => {
    const map = new Map<string, { qty: number; value: number }>()
    rows.forEach(r => {
      const c = r.category || '기타'
      const cur = map.get(c) || { qty: 0, value: 0 }
      cur.qty   += r.total_qty_range
      cur.value += r.total_qty_range * priceOf(r)
      map.set(c, cur)
    })
    return Array.from(map.entries())
      .map(([k, v]) => ({ category: k, value: viewMode === 'qty' ? v.qty : v.value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [rows, viewMode, costSource])

  // ── Dead Stock ──
  const deadStock = useMemo(() => {
    return filtered
      .filter(r => r.total_qty_range === 0 && (r.hq_stock + r.coupang_stock) > 0)
      .map(r => ({
        ...r,
        total_stock: r.hq_stock + r.coupang_stock,
        stock_value: (r.hq_stock + r.coupang_stock) * priceOf(r),
      }))
      .sort((a, b) =>
        viewMode === 'qty'
          ? b.total_stock - a.total_stock
          : b.stock_value - a.stock_value,
      )
  }, [filtered, viewMode, costSource])

  const deadStockTotal = useMemo(() => {
    return deadStock.reduce((s, d) => s + (viewMode === 'qty' ? d.total_stock : d.stock_value), 0)
  }, [deadStock, viewMode])

  // ── 헬퍼 ──
  const toggleExpand = (name: string) => {
    const s = new Set(expanded)
    if (s.has(name)) s.delete(name); else s.add(name)
    setExpanded(s)
  }
  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDesc(!sortDesc)
    else { setSortBy(key); setSortDesc(true) }
  }
  const valueFor = (qty: number, cost: number) =>
    viewMode === 'qty' ? fmt(qty) : fmtMoney(qty * cost)

  return (
    <div>
      {/* ── 필터 바 ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cb" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>📅 기간</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }} />
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>~</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }} />
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => {
                const end = new Date(state.latestSaleDate || new Date())
                const start = new Date(end); start.setDate(end.getDate() - (d - 1))
                setFrom(toYMD(start)); setTo(toYMD(end))
              }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontWeight: 600 }}>
                {d}일
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>🏷️ 카테고리</span>
            <select value={category} onChange={e => setCategory(e.target.value)}
              style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }}>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setViewMode('qty')}
              style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                border: '1px solid var(--border)',
                background: viewMode === 'qty' ? 'var(--blue)' : 'var(--bg)',
                color: viewMode === 'qty' ? '#fff' : 'var(--t2)',
              }}>수량</button>
            <button onClick={() => setViewMode('amt')}
              style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                border: '1px solid var(--border)',
                background: viewMode === 'amt' ? 'var(--blue)' : 'var(--bg)',
                color: viewMode === 'amt' ? '#fff' : 'var(--t2)',
              }}>금액</button>

            {viewMode === 'amt' && (
              <>
                <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
                <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>원가</span>
                <button onClick={() => setCostSource('master')}
                  style={{
                    fontSize: 11, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                    border: '1px solid var(--border)',
                    background: costSource === 'master' ? 'var(--purple)' : 'var(--bg)',
                    color: costSource === 'master' ? '#fff' : 'var(--t2)',
                  }} title="상품마스터(이지어드민) 원가 기준">마스터</button>
                <button onClick={() => setCostSource('coupang')}
                  style={{
                    fontSize: 11, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                    border: '1px solid var(--border)',
                    background: costSource === 'coupang' ? 'var(--purple)' : 'var(--bg)',
                    color: costSource === 'coupang' ? '#fff' : 'var(--t2)',
                  }} title="쿠팡 허브 파일의 매입원가 기준">쿠팡</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 시즌 파이 + 카테고리 막대 ── */}
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
                <div className="es-ico">🎨</div><div className="es-t">시즌 데이터 없음</div>
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
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={categoryChart} margin={{ top: 8, right: 16, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} width={50}
                    tickFormatter={v => viewMode === 'qty' ? fmt(v) : fmtMoney(v)} />
                  <Tooltip formatter={(v: number) => viewMode === 'qty' ? fmt(v) + '개' : fmtMoney(v) + '원'} />
                  <Bar dataKey="value" fill={CAT_COLOR} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-st" style={{ height: 260 }}>
                <div className="es-ico">📊</div><div className="es-t">판매 데이터 없음</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Dead Stock ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">💤</div>
            <div><div className="ch-title">판매되지 않은 재고</div>
              <div className="ch-sub">{from} ~ {to} 기간 판매 0 · 재고 보유 {deadStock.length}개 상품
                {viewMode === 'qty' ? ` · 총 ${fmt(deadStockTotal)}개` : ` · 총 ${fmtMoney(deadStockTotal)}원`}</div>
            </div>
          </div>
        </div>
        <div className="cb">
          <div className="tw" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {deadStock.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>이미지</th>
                    <th>상품명</th>
                    <th>옵션</th>
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
                      <td style={{ fontWeight: 700, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td style={{ color: 'var(--t3)', fontSize: 11 }}>{r.option_value || '—'}</td>
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

      {/* ── 메인 재고 현황 테이블 ── */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📦</div>
            <div><div className="ch-title">재고 현황</div>
              <div className="ch-sub">전일 기준 일평균 기준 · 상품명 클릭 시 옵션 펼치기</div></div>
          </div>
        </div>
        <div className="cb">
          <div className="frow" style={{ marginBottom: 8 }}>
            <input className="si" placeholder="🔍 상품명 · 옵션 · 바코드 · 시즌 · 카테고리 검색..."
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
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>
                      상품명 {sortBy === 'name' ? (sortDesc ? '▼' : '▲') : ''}
                    </th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('hq_stock')}>
                      본사재고 {sortBy === 'hq_stock' ? (sortDesc ? '▼' : '▲') : ''}
                    </th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('coupang_stock')}>
                      쿠팡재고 {sortBy === 'coupang_stock' ? (sortDesc ? '▼' : '▲') : ''}
                    </th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('supply_qty')}>
                      공급중 {sortBy === 'supply_qty' ? (sortDesc ? '▼' : '▲') : ''}
                    </th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('daily_sales')}>
                      일평균판매 {sortBy === 'daily_sales' ? (sortDesc ? '▼' : '▲') : ''}
                    </th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('days_left')}>
                      소진예상 {sortBy === 'days_left' ? (sortDesc ? '▼' : '▲') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedGroups.length > 0 ? pagedGroups.flatMap(g => {
                    const isOpen = expanded.has(g.name)
                    const mainRow = (
                      <tr key={g.name} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(g.name)}>
                        <td>{g.image_url
                          ? <img src={g.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>-</div>}
                        </td>
                        <td style={{ fontWeight: 700, maxWidth: 260 }}>
                          <span style={{ marginRight: 6, color: 'var(--t3)', fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>
                          {g.name}
                          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--t3)' }}>({g.options.length}옵션)</span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {valueFor(g.hq_stock_sum, g.cost_avg)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {valueFor(g.coupang_stock_sum, g.cost_avg)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--purple)' }}>
                          {valueFor(g.supply_qty_sum, g.cost_avg)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {viewMode === 'qty' ? g.daily_sales_sum.toFixed(1) : fmtMoney(g.daily_sales_sum * g.cost_avg)}
                        </td>
                        <td style={{
                          textAlign: 'right', fontWeight: 800,
                          color:
                            g.days_left_min == null ? 'var(--t3)' :
                            g.days_left_min < 7  ? 'var(--red)' :
                            g.days_left_min < 14 ? 'var(--amber)' : 'var(--green)',
                        }}>
                          {g.days_left_min == null ? '—' : `${fmt(g.days_left_min)}일`}
                        </td>
                      </tr>
                    )
                    if (!isOpen) return [mainRow]
                    const optionRows = g.options.map(o => (
                      <tr key={g.name + '_' + o.barcode} style={{ background: 'var(--bg)' }}>
                        <td></td>
                        <td style={{ paddingLeft: 28, fontSize: 11, color: 'var(--t2)' }}>
                          └ {o.option_value || '(옵션 없음)'} <span style={{ color: 'var(--t3)', fontSize: 10 }}>· {o.barcode}</span>
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{valueFor(o.hq_stock, priceOf(o))}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{valueFor(o.coupang_stock, priceOf(o))}</td>
                        <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--purple)' }}>{valueFor(o.supply_qty, priceOf(o))}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>
                          {viewMode === 'qty' ? o.daily_sales.toFixed(1) : fmtMoney(o.daily_sales * priceOf(o))}
                        </td>
                        <td style={{
                          textAlign: 'right', fontSize: 11, fontWeight: 700,
                          color:
                            o.days_left == null ? 'var(--t3)' :
                            o.days_left < 7  ? 'var(--red)' :
                            o.days_left < 14 ? 'var(--amber)' : 'var(--green)',
                        }}>
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

          {pagedGroups.length > 0 && pagedGroups.length < sortedGroups.length && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <button onClick={() => setPage(p => p + 1)}
                style={{ fontSize: 12, padding: '8px 20px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontWeight: 700 }}>
                더 보기 ({pagedGroups.length} / {sortedGroups.length})
              </button>
            </div>
          )}
          {pagedGroups.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--t3)', textAlign: 'center', marginTop: 8 }}>
              전체 {fmt(sortedGroups.length)}개 상품 · {fmt(filtered.length)}개 옵션 · 페이지 {page}/{totalPages}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

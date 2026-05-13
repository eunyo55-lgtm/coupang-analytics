'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  defaultDateFrom: string  // 'YYYY-MM-DD' (부모 dateRange에서 동기화)
  defaultDateTo: string
}

type BreakdownRow = {
  name: string
  ad_cost: number
  revenue_14d: number
  revenue_1d: number
  impressions: number
  clicks: number
  orders_14d: number
  units_14d: number
}

type Tab = 'campaign' | 'product' | 'keyword' | 'placement'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'campaign',  label: '캠페인별',   icon: '📋' },
  { id: 'product',   label: '상품별',     icon: '📦' },
  { id: 'keyword',   label: '키워드별',   icon: '🔍' },
  { id: 'placement', label: '노출지면별', icon: '📍' },
]

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

type SortKey = 'ad_cost' | 'revenue_14d' | 'roas' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'orders_14d'

function shiftYMD(ymd: string, deltaDays: number): string {
  // toISOString = UTC라 KST에선 하루 밀림 → 로컬 컴포넌트 직접 조립
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + deltaDays)
  const yyyy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
function diffDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime()
  const b = new Date(to + 'T00:00:00').getTime()
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}

/**
 * 광고 차원별 성과 표 — 독립 날짜 필터 + 전 기간 비교.
 */
export default function AdBreakdownTables({ defaultDateFrom, defaultDateTo }: Props) {
  const [tab, setTab] = useState<Tab>('campaign')
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)
  const [syncedWithParent, setSyncedWithParent] = useState(true)
  const [showCompare, setShowCompare] = useState(true)

  const [rows, setRows] = useState<BreakdownRow[]>([])
  const [prevRows, setPrevRows] = useState<BreakdownRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('ad_cost')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [limit, setLimit] = useState<number>(20)

  // 부모 dateRange 동기화
  useEffect(() => {
    if (syncedWithParent) {
      setDateFrom(defaultDateFrom)
      setDateTo(defaultDateTo)
    }
  }, [defaultDateFrom, defaultDateTo, syncedWithParent])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      setLoading(true)
      try {
        const periodDays = diffDays(dateFrom, dateTo)
        const prevTo = shiftYMD(dateFrom, -1)
        const prevFrom = shiftYMD(dateFrom, -periodDays)

        const [currRes, prevRes] = await Promise.all([
          supabase.rpc('get_ad_breakdown', { p_date_from: dateFrom, p_date_to: dateTo, p_group_by: tab }),
          showCompare
            ? supabase.rpc('get_ad_breakdown', { p_date_from: prevFrom, p_date_to: prevTo, p_group_by: tab })
            : Promise.resolve({ data: [] as BreakdownRow[], error: null }),
        ])
        if (cancelled) return
        if (currRes.error) {
          console.warn('[AdBreakdownTables] load curr:', currRes.error.message)
          setRows([])
        } else {
          setRows((currRes.data as BreakdownRow[]) || [])
        }
        if (prevRes.error) {
          console.warn('[AdBreakdownTables] load prev:', prevRes.error.message)
          setPrevRows([])
        } else {
          setPrevRows((prevRes.data as BreakdownRow[]) || [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dateFrom, dateTo, tab, showCompare])

  function applyPreset(days: number) {
    const to = defaultDateTo
    const from = shiftYMD(to, -(days - 1))
    setDateFrom(from)
    setDateTo(to)
    setSyncedWithParent(false)
  }
  function syncWithParent() {
    setDateFrom(defaultDateFrom)
    setDateTo(defaultDateTo)
    setSyncedWithParent(true)
  }

  const prevMap = useMemo(() => {
    const m = new Map<string, BreakdownRow>()
    for (const p of prevRows) m.set(p.name, p)
    return m
  }, [prevRows])

  const enriched = useMemo(() => {
    return rows.map(r => {
      const ad_cost = Number(r.ad_cost || 0)
      const revenue_14d = Number(r.revenue_14d || 0)
      const impressions = Number(r.impressions || 0)
      const clicks = Number(r.clicks || 0)
      const orders_14d = Number(r.orders_14d || 0)
      const roas = ad_cost > 0 ? revenue_14d / ad_cost : 0
      const ctr = impressions > 0 ? clicks / impressions * 100 : 0
      const cpc = clicks > 0 ? ad_cost / clicks : 0

      // 전 기간 매칭
      const p = prevMap.get(r.name)
      const p_ad_cost = p ? Number(p.ad_cost || 0) : 0
      const p_revenue = p ? Number(p.revenue_14d || 0) : 0
      const p_roas = p_ad_cost > 0 ? p_revenue / p_ad_cost : 0

      const cost_pct = p_ad_cost > 0 ? (ad_cost - p_ad_cost) / p_ad_cost * 100 : (ad_cost > 0 ? 100 : 0)
      const rev_pct  = p_revenue > 0 ? (revenue_14d - p_revenue) / p_revenue * 100 : (revenue_14d > 0 ? 100 : 0)
      // ROAS는 %p 단위 변동
      const roas_pp  = (roas - p_roas) * 100

      const isNew = !p && (ad_cost > 0 || revenue_14d > 0)

      return {
        ...r, ad_cost, revenue_14d, impressions, clicks, orders_14d, roas, ctr, cpc,
        p_ad_cost, p_revenue, p_roas,
        cost_pct, rev_pct, roas_pp, isNew,
      }
    })
  }, [rows, prevMap])

  const sorted = useMemo(() => {
    const arr = [...enriched]
    arr.sort((a, b) => {
      const av = (a as any)[sortBy] as number
      const bv = (b as any)[sortBy] as number
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return arr
  }, [enriched, sortBy, sortDir])

  const display = sorted.slice(0, limit)

  function clickSort(k: SortKey) {
    if (sortBy === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(k); setSortDir('desc') }
  }
  const arrow = (k: SortKey) => sortBy === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''

  const totals = useMemo(() => {
    return enriched.reduce((acc, r) => ({
      ad_cost: acc.ad_cost + r.ad_cost,
      revenue_14d: acc.revenue_14d + r.revenue_14d,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      orders_14d: acc.orders_14d + r.orders_14d,
    }), { ad_cost: 0, revenue_14d: 0, impressions: 0, clicks: 0, orders_14d: 0 })
  }, [enriched])

  const totalRoas = totals.ad_cost > 0 ? totals.revenue_14d / totals.ad_cost : 0

  const periodDays = diffDays(dateFrom, dateTo)
  const prevFromY = shiftYMD(dateFrom, -periodDays)
  const prevToY = shiftYMD(dateFrom, -1)

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">🧮</div>
          <div>
            <div className="ch-title">차원별 성과</div>
            <div className="ch-sub">
              {dateFrom} ~ {dateTo}
              {syncedWithParent ? ' (상단 기간과 동기화)' : ' (독립 기간)'}
              {showCompare ? ` · 전 기간 비교: ${prevFromY} ~ ${prevToY}` : ''}
            </div>
          </div>
        </div>
        <div className="ch-r" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                background: tab === t.id ? '#2563eb' : '#f1f5f9',
                color: tab === t.id ? 'white' : '#475569',
                border: 'none',
              }}
            >{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      {/* 날짜 필터 + 비교 토글 */}
      <div style={{
        padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12,
      }}>
        <span style={{ color: '#475569', fontWeight: 600 }}>📅 기간:</span>
        {[7, 14, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => applyPreset(d)}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: 'white', color: '#475569', border: '1px solid #e2e8f0',
            }}
          >최근 {d}일</button>
        ))}
        <span style={{ color: '#cbd5e1' }}>|</span>
        <input
          type="date" value={dateFrom} max={dateTo}
          onChange={e => { setDateFrom(e.target.value); setSyncedWithParent(false) }}
          style={inputStyle}
        />
        <span style={{ color: '#94a3b8' }}>~</span>
        <input
          type="date" value={dateTo} min={dateFrom}
          onChange={e => { setDateTo(e.target.value); setSyncedWithParent(false) }}
          style={inputStyle}
        />
        {!syncedWithParent && (
          <button
            onClick={syncWithParent}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd',
            }}
          >🔄 상단 기간과 동기화</button>
        )}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#475569' }}>
          <input
            type="checkbox" checked={showCompare}
            onChange={e => setShowCompare(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          전 기간 비교 표시
        </label>
      </div>

      <div className="cb" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>로드 중...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>
            데이터가 없습니다. (get_ad_breakdown RPC가 Supabase에 설치되어 있는지 확인하세요)
          </div>
        ) : (
          <>
            {/* 합계 요약 */}
            <div style={{ padding: '10px 14px', background: '#f8fafc', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>총 {sorted.length}개</span>
              <span>광고비 <b>{fmt(totals.ad_cost)}원</b></span>
              <span>광고매출 <b>{fmt(totals.revenue_14d)}원</b></span>
              <span>ROAS <b style={{ color: totalRoas >= 5 ? '#16a34a' : totalRoas >= 2 ? '#f59e0b' : '#dc2626' }}>{(totalRoas * 100).toFixed(0)}%</b></span>
              <span>주문 <b>{fmt(totals.orders_14d)}</b></span>
              <span style={{ marginLeft: 'auto' }}>
                표시:
                {[10, 20, 50, 100].map(n => (
                  <button key={n} onClick={() => setLimit(n)} style={{
                    marginLeft: 4, padding: '2px 8px', fontSize: 11,
                    background: limit === n ? '#2563eb' : 'white',
                    color: limit === n ? 'white' : '#475569',
                    border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer',
                  }}>{n}</button>
                ))}
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', color: '#475569' }}>
                    <th style={{ ...th, textAlign: 'left' }}>{TABS.find(t => t.id === tab)?.label.replace('별', '')}</th>
                    <th style={th} onClick={() => clickSort('ad_cost')}>광고비{arrow('ad_cost')}</th>
                    <th style={th} onClick={() => clickSort('revenue_14d')}>광고매출{arrow('revenue_14d')}</th>
                    <th style={th} onClick={() => clickSort('roas')}>ROAS{arrow('roas')}</th>
                    <th style={th} onClick={() => clickSort('impressions')}>노출{arrow('impressions')}</th>
                    <th style={th} onClick={() => clickSort('clicks')}>클릭{arrow('clicks')}</th>
                    <th style={th} onClick={() => clickSort('ctr')}>CTR{arrow('ctr')}</th>
                    <th style={th} onClick={() => clickSort('cpc')}>CPC{arrow('cpc')}</th>
                    <th style={th} onClick={() => clickSort('orders_14d')}>주문{arrow('orders_14d')}</th>
                  </tr>
                </thead>
                <tbody>
                  {display.map((r, i) => {
                    const roasColor = r.roas >= 5 ? '#16a34a' : r.roas >= 2 ? '#f59e0b' : r.roas > 0 ? '#dc2626' : '#94a3b8'
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ ...td, textAlign: 'left', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}
                            title={r.name}>
                          {r.name}
                          {showCompare && r.isNew && (
                            <span style={{ marginLeft: 4, fontSize: 9, color: '#7c3aed', background: '#ede9fe', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>NEW</span>
                          )}
                        </td>
                        <td style={td}>
                          {fmt(r.ad_cost)}
                          {showCompare && !r.isNew && <DeltaText pct={r.cost_pct} direction="neutral" />}
                        </td>
                        <td style={td}>
                          {fmt(r.revenue_14d)}
                          {showCompare && !r.isNew && <DeltaText pct={r.rev_pct} direction="higher_better" />}
                        </td>
                        <td style={{ ...td, color: roasColor, fontWeight: 700 }}>
                          {(r.roas * 100).toFixed(0)}%
                          {showCompare && !r.isNew && (
                            <DeltaText pct={r.roas_pp} direction="higher_better" suffix="%p" forceSign />
                          )}
                        </td>
                        <td style={td}>{fmt(r.impressions)}</td>
                        <td style={td}>{fmt(r.clicks)}</td>
                        <td style={td}>{r.ctr.toFixed(2)}%</td>
                        <td style={td}>{fmt(r.cpc)}</td>
                        <td style={td}>{fmt(r.orders_14d)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** 비교 변동률 inline 표시 */
function DeltaText({ pct, direction, suffix = '%', forceSign = false }: {
  pct: number
  direction: 'higher_better' | 'lower_better' | 'neutral'
  suffix?: string
  forceSign?: boolean
}) {
  const isUp = pct > 0
  const isDown = pct < 0
  const isGood = direction === 'higher_better' ? isUp : direction === 'lower_better' ? isDown : false
  const isBad  = direction === 'higher_better' ? isDown : direction === 'lower_better' ? isUp : false
  const color = Math.abs(pct) < 0.1 ? '#94a3b8' : isGood ? '#16a34a' : isBad ? '#dc2626' : '#64748b'
  const sign = forceSign && pct > 0 ? '+' : pct < 0 ? '−' : ''
  const display = Math.abs(pct) < 0.1 ? '0' : (sign + Math.abs(pct).toFixed(0))
  return (
    <div style={{ fontSize: 9, color, fontWeight: 600, marginTop: 1 }}>
      {display}{suffix}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #e2e8f0',
  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', color: '#334155' }
const inputStyle: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 4,
  background: 'white', color: '#334155', fontFamily: 'inherit',
}

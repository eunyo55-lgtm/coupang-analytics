'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  dateFrom: string  // 'YYYY-MM-DD'
  dateTo: string
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

/**
 * 광고 차원별 성과 표 — 쿠팡 광고 콘솔의 캠페인/상품/키워드/노출지면 탭과 동일.
 * Supabase RPC: get_ad_breakdown(date, date, text) 사용.
 *   p_group_by: 'campaign' | 'product' | 'keyword' | 'placement'
 */
export default function AdBreakdownTables({ dateFrom, dateTo }: Props) {
  const [tab, setTab] = useState<Tab>('campaign')
  const [rows, setRows] = useState<BreakdownRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('ad_cost')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [limit, setLimit] = useState<number>(20)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      setLoading(true)
      try {
        const { data, error } = await supabase.rpc('get_ad_breakdown', {
          p_date_from: dateFrom,
          p_date_to: dateTo,
          p_group_by: tab,
        })
        if (error) {
          console.warn('[AdBreakdownTables] load:', error.message)
          if (!cancelled) setRows([])
          return
        }
        if (!cancelled) setRows((data as BreakdownRow[]) || [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dateFrom, dateTo, tab])

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
      const cvr = clicks > 0 ? orders_14d / clicks * 100 : 0
      return { ...r, ad_cost, revenue_14d, impressions, clicks, orders_14d, roas, ctr, cpc, cvr }
    })
  }, [rows])

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

  // 합계
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

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">🧮</div>
          <div>
            <div className="ch-title">차원별 성과</div>
            <div className="ch-sub">{dateFrom} ~ {dateTo} · 캠페인/상품/키워드/노출지면 분석</div>
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
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
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

            {/* 표 */}
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
                            title={r.name}>{r.name}</td>
                        <td style={td}>{fmt(r.ad_cost)}</td>
                        <td style={td}>{fmt(r.revenue_14d)}</td>
                        <td style={{ ...td, color: roasColor, fontWeight: 700 }}>{(r.roas * 100).toFixed(0)}%</td>
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

const th: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #e2e8f0',
  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', color: '#334155' }

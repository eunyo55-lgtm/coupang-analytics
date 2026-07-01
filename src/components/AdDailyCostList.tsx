'use client'
import { useState, useMemo, useEffect } from 'react'

type AdDaily = {
  date: string
  ad_cost: number
  revenue_14d: number
  revenue_1d: number
  impressions: number
  clicks: number
  orders_14d: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
const pct = (n: number) => `${(n * 100).toFixed(2)}%`

export default function AdDailyCostList({ csvDailyAll }: { csvDailyAll: AdDaily[] }) {
  // 데이터가 있는 범위 안에서 기본 최근 30일
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    if (csvDailyAll.length === 0) return
    const max = csvDailyAll[csvDailyAll.length - 1].date
    const maxDate = new Date(max + 'T00:00:00')
    const minDate = new Date(maxDate.getTime() - 29 * 86400000)
    const minStr = minDate.toISOString().slice(0, 10)
    setFrom(minStr)
    setTo(max)
  }, [csvDailyAll.length])

  const filtered = useMemo(() => {
    if (!from || !to) return []
    return csvDailyAll
      .filter(r => r.date >= from && r.date <= to)
      .sort((a, b) => b.date.localeCompare(a.date))  // 최신 위
  }, [csvDailyAll, from, to])

  const totals = useMemo(() => {
    const t = { ad_cost: 0, revenue_14d: 0, revenue_1d: 0, impressions: 0, clicks: 0, orders_14d: 0 }
    filtered.forEach(r => {
      t.ad_cost += r.ad_cost || 0
      t.revenue_14d += r.revenue_14d || 0
      t.revenue_1d += r.revenue_1d || 0
      t.impressions += r.impressions || 0
      t.clicks += r.clicks || 0
      t.orders_14d += r.orders_14d || 0
    })
    return t
  }, [filtered])

  const avgAdCost = filtered.length > 0 ? Math.round(totals.ad_cost / filtered.length) : 0
  const maxAdCost = filtered.reduce((m, r) => Math.max(m, r.ad_cost || 0), 0)

  const setLast = (days: number) => {
    if (csvDailyAll.length === 0) return
    const max = csvDailyAll[csvDailyAll.length - 1].date
    const maxDate = new Date(max + 'T00:00:00')
    const minDate = new Date(maxDate.getTime() - (days - 1) * 86400000)
    setFrom(minDate.toISOString().slice(0, 10))
    setTo(max)
  }

  const setThisMonth = () => {
    if (csvDailyAll.length === 0) return
    const max = csvDailyAll[csvDailyAll.length - 1].date
    const d = new Date(max + 'T00:00:00')
    const first = new Date(d.getFullYear(), d.getMonth(), 1)
    setFrom(first.toISOString().slice(0, 10))
    setTo(max)
  }

  if (csvDailyAll.length === 0) return null

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">📅</div>
          <div>
            <div className="ch-title">일별 광고비 리스트</div>
            <div className="ch-sub">
              {filtered.length}일 · 합계 광고비 <b style={{ color: '#f59e0b' }}>{fmt(totals.ad_cost)}원</b> · 일평균 <b>{fmt(avgAdCost)}원</b> · VAT 별도
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <input
            type="date"
            value={from}
            max={to}
            onChange={e => setFrom(e.target.value)}
            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          />
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>~</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={e => setTo(e.target.value)}
            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          />
          <button onClick={() => setLast(7)} style={presetBtnStyle}>7일</button>
          <button onClick={() => setLast(30)} style={presetBtnStyle}>30일</button>
          <button onClick={setThisMonth} style={presetBtnStyle}>이번 달</button>
        </div>
      </div>
      <div className="cb" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto', maxHeight: 500 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle('left', 90)}>날짜</th>
                <th style={thStyle('right', 100, '#f59e0b')}>광고비</th>
                <th style={thStyle('right', 100)}>매출(14d)</th>
                <th style={thStyle('right', 70)}>ROAS</th>
                <th style={thStyle('right', 90)}>노출수</th>
                <th style={thStyle('right', 70)}>클릭수</th>
                <th style={thStyle('right', 60)}>CTR</th>
                <th style={thStyle('right', 60)}>CPC</th>
                <th style={thStyle('right', 60)}>주문(14d)</th>
                <th style={thStyle('right', 80)}>CPA</th>
              </tr>
            </thead>
            <tbody>
              {/* 합계 row */}
              <tr style={{ background: '#fef3c7', fontWeight: 700, borderBottom: '2px solid #f59e0b' }}>
                <td style={tdStyle('left')}>합계</td>
                <td style={tdStyle('right', '#f59e0b')}>{fmt(totals.ad_cost)}</td>
                <td style={tdStyle('right')}>{fmt(totals.revenue_14d)}</td>
                <td style={tdStyle('right')}>
                  {totals.ad_cost > 0 ? (totals.revenue_14d / totals.ad_cost * 100).toFixed(0) + '%' : '-'}
                </td>
                <td style={tdStyle('right')}>{fmt(totals.impressions)}</td>
                <td style={tdStyle('right')}>{fmt(totals.clicks)}</td>
                <td style={tdStyle('right')}>
                  {totals.impressions > 0 ? pct(totals.clicks / totals.impressions) : '-'}
                </td>
                <td style={tdStyle('right')}>
                  {totals.clicks > 0 ? fmt(totals.ad_cost / totals.clicks) : '-'}
                </td>
                <td style={tdStyle('right')}>{fmt(totals.orders_14d)}</td>
                <td style={tdStyle('right')}>
                  {totals.orders_14d > 0 ? fmt(totals.ad_cost / totals.orders_14d) : '-'}
                </td>
              </tr>

              {/* 일별 row */}
              {filtered.map(r => {
                const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0
                const cpc = r.clicks > 0 ? r.ad_cost / r.clicks : 0
                const cpa = r.orders_14d > 0 ? r.ad_cost / r.orders_14d : 0
                const roas = r.ad_cost > 0 ? r.revenue_14d / r.ad_cost : 0
                const isHighCost = r.ad_cost >= maxAdCost * 0.85  // 최대 대비 85% 이상 = 큰 지출
                const dow = new Date(r.date + 'T00:00:00').getDay()
                const isWeekend = dow === 0 || dow === 6
                return (
                  <tr key={r.date} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...tdStyle('left'), fontWeight: 600, color: isWeekend ? '#dc2626' : 'inherit' }}>
                      {r.date.slice(5)} <span style={{ fontSize: 10, color: 'var(--t3)' }}>{['일','월','화','수','목','금','토'][dow]}</span>
                    </td>
                    <td style={{ ...tdStyle('right', '#f59e0b'), fontWeight: isHighCost ? 800 : 700 }}>
                      {fmt(r.ad_cost)}
                    </td>
                    <td style={tdStyle('right')}>{fmt(r.revenue_14d)}</td>
                    <td style={{ ...tdStyle('right'), color: roas >= 3 ? '#10b981' : roas >= 1 ? 'inherit' : '#dc2626', fontWeight: 700 }}>
                      {r.ad_cost > 0 ? (roas * 100).toFixed(0) + '%' : '-'}
                    </td>
                    <td style={tdStyle('right')}>{fmt(r.impressions)}</td>
                    <td style={tdStyle('right')}>{fmt(r.clicks)}</td>
                    <td style={tdStyle('right')}>{ctr > 0 ? pct(ctr) : '-'}</td>
                    <td style={tdStyle('right')}>{cpc > 0 ? fmt(cpc) : '-'}</td>
                    <td style={tdStyle('right')}>{fmt(r.orders_14d)}</td>
                    <td style={tdStyle('right')}>{cpa > 0 ? fmt(cpa) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const presetBtnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--t2)',
  cursor: 'pointer',
  fontWeight: 600,
}

function thStyle(align: 'left' | 'right', width: number, color?: string): React.CSSProperties {
  return {
    padding: '8px 10px',
    textAlign: align,
    fontWeight: 600,
    fontSize: 11,
    color: color || 'var(--t2)',
    width,
    whiteSpace: 'nowrap',
  }
}

function tdStyle(align: 'left' | 'right', color?: string): React.CSSProperties {
  return {
    padding: '6px 10px',
    textAlign: align,
    color: color || 'inherit',
    whiteSpace: 'nowrap',
    fontSize: 12,
  }
}

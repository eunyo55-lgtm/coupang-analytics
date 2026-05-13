'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  ComposedChart, LineChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'

interface Props {
  dateFrom: string  // 'YYYY-MM-DD'
  dateTo: string
}

type AdDailyRow = {
  date: string
  ad_cost: number
  revenue_14d: number
  revenue_1d: number
  impressions: number
  clicks: number
  orders_14d: number
  units_14d: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
const fmtShort = (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}만` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))

/**
 * 광고 성과 차트 — 쿠팡 광고 콘솔 UI 참고.
 *  1) 일별 추이 (전체매출/광고매출/광고비 — 막대+선 복합)
 *  2) 주간 집계 표 (광고매출, 광고비, 노출, 클릭, CTR, CPC, ROAS, 주문)
 */
export default function AdPerformanceCharts({ dateFrom, dateTo }: Props) {
  const [rows, setRows] = useState<AdDailyRow[]>([])
  const [totalDailyRevenue, setTotalDailyRevenue] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      setLoading(true)
      try {
        // 광고 일별 합계 (CSV 업로드분)
        const { data: ad, error: adErr } = await supabase
          .from('coupang_ad_daily_summary')
          .select('date, ad_cost, revenue_14d, revenue_1d, impressions, clicks, orders_14d, units_14d')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .order('date', { ascending: true })
        if (adErr) console.warn('[AdPerformanceCharts] ad load:', adErr.message)

        // 전체매출 (sales_data) — 일별 매출 합계
        const { data: sales, error: sErr } = await supabase
          .rpc('get_daily_revenue_range', { p_date_from: dateFrom, p_date_to: dateTo })
        if (sErr) {
          // RPC 미설치 시 fallback: 직접 집계 (대용량이면 느려질 수 있음 → 안내)
          console.warn('[AdPerformanceCharts] get_daily_revenue_range missing, fallback skipped:', sErr.message)
        }
        const revMap: Record<string, number> = {}
        for (const r of (sales as Array<{ sale_date: string; total_revenue: number }> | null) ?? []) {
          revMap[r.sale_date] = Number(r.total_revenue || 0)
        }

        if (!cancelled) {
          setRows((ad as AdDailyRow[]) || [])
          setTotalDailyRevenue(revMap)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dateFrom, dateTo])

  // 일별 차트 데이터 (전체매출 + 광고매출 막대 / 광고비 선)
  const dailyChartData = useMemo(() => {
    return rows.map(r => ({
      date: r.date.slice(5), // MM-DD
      전체매출: totalDailyRevenue[r.date] ?? 0,
      광고매출: Number(r.revenue_14d || 0),
      광고비: Number(r.ad_cost || 0),
    }))
  }, [rows, totalDailyRevenue])

  // 주간 집계 (월요일 시작)
  const weeklyData = useMemo(() => {
    if (rows.length === 0) return []
    const buckets: Record<string, {
      weekStart: string
      ad_cost: number
      revenue_14d: number
      total_revenue: number
      impressions: number
      clicks: number
      orders_14d: number
      units_14d: number
    }> = {}
    for (const r of rows) {
      const d = new Date(r.date + 'T00:00:00')
      // 월요일 시작 (KST 가정)
      const dayOfWeek = d.getDay() // 0=일, 1=월
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      const monday = new Date(d.getTime() + diff * 86400_000)
      const wk = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
      if (!buckets[wk]) {
        buckets[wk] = {
          weekStart: wk,
          ad_cost: 0, revenue_14d: 0, total_revenue: 0,
          impressions: 0, clicks: 0, orders_14d: 0, units_14d: 0,
        }
      }
      const b = buckets[wk]
      b.ad_cost += Number(r.ad_cost || 0)
      b.revenue_14d += Number(r.revenue_14d || 0)
      b.total_revenue += totalDailyRevenue[r.date] ?? 0
      b.impressions += Number(r.impressions || 0)
      b.clicks += Number(r.clicks || 0)
      b.orders_14d += Number(r.orders_14d || 0)
      b.units_14d += Number(r.units_14d || 0)
    }
    return Object.values(buckets).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  }, [rows, totalDailyRevenue])

  // 주간 차트용 (광고매출 vs 광고비 막대)
  const weeklyChartData = useMemo(() => {
    return weeklyData.map(w => ({
      week: w.weekStart.slice(5), // MM-DD
      광고매출: w.revenue_14d,
      광고비: w.ad_cost,
    }))
  }, [weeklyData])

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>📊 광고 성과 데이터 로드 중...</div>
      </div>
    )
  }

  // 데이터 없음 → 상단 노란 배너(AdPage)가 이미 안내하므로 여기서는 카드 자체를 그리지 않음
  if (rows.length === 0) return null

  return (
    <div style={{ marginBottom: 12 }}>
      {/* ── 일별 추이 ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l">
            <div className="ch-ico">📈</div>
            <div>
              <div className="ch-title">일별 매출/광고 추이</div>
              <div className="ch-sub">{dateFrom} ~ {dateTo} · 전체매출과 광고매출 비교</div>
            </div>
          </div>
        </div>
        <div className="cb">
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={dailyChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={fmtShort}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: '#ef4444' }}
                  tickFormatter={fmtShort}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }}
                  formatter={(v: number) => fmt(v) + '원'}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="전체매출" fill="#bfdbfe" />
                <Bar yAxisId="left" dataKey="광고매출" fill="#2563eb" />
                <Line yAxisId="right" type="monotone" dataKey="광고비" stroke="#ef4444" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── 주간 집계 ── */}
      {weeklyData.length >= 2 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="ch">
            <div className="ch-l">
              <div className="ch-ico">📅</div>
              <div>
                <div className="ch-title">주간 집계</div>
                <div className="ch-sub">월요일 시작 · 광고매출과 광고비 비교</div>
              </div>
            </div>
          </div>
          <div className="cb">
            <div style={{ width: '100%', height: 200, marginBottom: 12 }}>
              <ResponsiveContainer>
                <LineChart data={weeklyChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={fmtShort} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }}
                    formatter={(v: number) => fmt(v) + '원'}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="광고매출" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="광고비" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 주간 상세 표 */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', color: '#475569' }}>
                    <th style={th}>주차</th>
                    <th style={th}>광고비</th>
                    <th style={th}>광고매출</th>
                    <th style={th}>ROAS</th>
                    <th style={th}>노출</th>
                    <th style={th}>클릭</th>
                    <th style={th}>CTR</th>
                    <th style={th}>CPC</th>
                    <th style={th}>주문</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyData.map(w => {
                    const roas = w.ad_cost > 0 ? w.revenue_14d / w.ad_cost : 0
                    const ctr = w.impressions > 0 ? w.clicks / w.impressions * 100 : 0
                    const cpc = w.clicks > 0 ? w.ad_cost / w.clicks : 0
                    const roasColor = roas >= 5 ? '#16a34a' : roas >= 2 ? '#f59e0b' : '#dc2626'
                    return (
                      <tr key={w.weekStart} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={td}>{w.weekStart.slice(5)}~</td>
                        <td style={td}>{fmt(w.ad_cost)}</td>
                        <td style={td}>{fmt(w.revenue_14d)}</td>
                        <td style={{ ...td, color: roasColor, fontWeight: 700 }}>{(roas * 100).toFixed(0)}%</td>
                        <td style={td}>{fmt(w.impressions)}</td>
                        <td style={td}>{fmt(w.clicks)}</td>
                        <td style={td}>{ctr.toFixed(2)}%</td>
                        <td style={td}>{fmt(cpc)}</td>
                        <td style={td}>{fmt(w.orders_14d)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }
const td: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', color: '#334155' }

'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { vatExcluded, VAT_LABEL } from '@/lib/vatUtils'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis,
  Tooltip, Legend, ReferenceLine, LabelList,
} from 'recharts'

type DailyTrend = {
  date: string       // 'MM-DD'
  fullDate: string   // 'YYYY-MM-DD'
  qty: number
  rev: number        // 총 매출 (VAT 별도, 이미 변환됨)
}

type Props = {
  dailyTrend: DailyTrend[]
  chartFrom: string
  chartTo: string
  mode: 'qty' | 'rev'
  salesDataLoading: boolean
}

type AdDailyRow = {
  date: string
  ad_cost: number
  revenue_1d: number
}

// 톤 다운된 팔레트 (slate + warm khaki)
const COLOR_ORGANIC = '#7C9CBF'   // 차분한 스틸 블루
const COLOR_AD      = '#C49B6C'   // 따뜻한 카키/탠
const COLOR_LINE    = '#475569'   // slate-700 (qty mode 선)

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

export default function SalesAdOrganicSection({
  dailyTrend, chartFrom, chartTo, mode, salesDataLoading,
}: Props) {
  const [adRows, setAdRows] = useState<AdDailyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [hasAdData, setHasAdData] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!chartFrom || !chartTo) return
    async function load() {
      if (!supabase) return
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('coupang_ad_daily_summary')
          .select('date, ad_cost, revenue_1d')
          .gte('date', chartFrom)
          .lte('date', chartTo)
          .order('date', { ascending: true })
        if (cancelled) return
        if (error) {
          console.warn('[SalesAdOrganicSection] load:', error.message)
          setAdRows([])
          setHasAdData(false)
          return
        }
        const rows = ((data || []) as AdDailyRow[]).map(r => ({
          date: r.date,
          ad_cost: vatExcluded(Number(r.ad_cost || 0)),
          revenue_1d: vatExcluded(Number(r.revenue_1d || 0)),
        }))
        setAdRows(rows)
        setHasAdData(rows.length > 0)
      } catch (e) {
        console.warn('[SalesAdOrganicSection] load error:', e)
        if (!cancelled) { setAdRows([]); setHasAdData(false) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [chartFrom, chartTo])

  // 날짜별 병합
  const merged = useMemo(() => {
    const adByDate: Record<string, AdDailyRow> = {}
    adRows.forEach(r => { adByDate[r.date] = r })
    return dailyTrend.map(d => {
      const ad = adByDate[d.fullDate]
      const adRev = ad ? ad.revenue_1d : 0
      const adCost = ad ? ad.ad_cost : 0
      const total = d.rev
      const organic = Math.max(0, total - adRev)
      const adShown = total >= adRev ? adRev : total
      const ratio = total > 0 ? (adRev / total) * 100 : 0
      return {
        date: d.date,
        fullDate: d.fullDate,
        qty: d.qty,
        total,
        adRev: adShown,
        adCost,
        organic,
        ratio: Math.round(ratio * 10) / 10,
      }
    })
  }, [dailyTrend, adRows])

  // 기간 합계
  const totals = useMemo(() => {
    const t = { total: 0, adRev: 0, adCost: 0, organic: 0, qty: 0 }
    merged.forEach(r => {
      t.total += r.total
      t.adRev += r.adRev
      t.adCost += r.adCost
      t.organic += r.organic
      t.qty += r.qty
    })
    const ratio = t.total > 0 ? (t.adRev / t.total) * 100 : 0
    const roas = t.adCost > 0 ? (t.adRev / t.adCost) * 100 : 0
    return { ...t, ratio, roas }
  }, [merged])

  const todayMD = (() => {
    const t = new Date()
    return `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`
  })()

  const isRev = mode === 'rev'
  const showEmpty = merged.length === 0
  const emptyIcon = salesDataLoading ? '⏳' : '📭'
  const emptyText = salesDataLoading ? '판매 데이터 불러오는 중...' : '기간 내 매출 데이터가 없어요'

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">📈</div>
          <div>
            <div className="ch-title">
              일별 판매 추이 {isRev ? '(매출 · 광고 vs 오가닉)' : '(수량)'}
            </div>
            <div className="ch-sub">
              {chartFrom} ~ {chartTo} · {merged.length}일
              {isRev && ' · 1일 어트리뷰션 · ' + VAT_LABEL}
              {loading && ' · 불러오는 중...'}
            </div>
          </div>
        </div>
      </div>
      <div className="cb">
        {/* KPI 카드 — rev 모드만 (광고 vs 오가닉 의미 있음) */}
        {isRev && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
            <KpiCard label="총 매출"      value={fmt(totals.total) + '원'} color="#0F172A" />
            <KpiCard
              label="광고 매출"
              value={fmt(totals.adRev) + '원'}
              sub={hasAdData ? `광고비 ${fmt(totals.adCost)}원 · ROAS ${totals.roas.toFixed(0)}%` : '광고 데이터 없음'}
              color={COLOR_AD}
            />
            <KpiCard
              label="오가닉 매출"
              value={fmt(totals.organic) + '원'}
              sub={`전체의 ${(100 - totals.ratio).toFixed(1)}%`}
              color={COLOR_ORGANIC}
            />
            <KpiCard
              label="광고 의존도"
              value={totals.ratio.toFixed(1) + '%'}
              sub={
                totals.ratio >= 50 ? '⚠️ 높음 — 오가닉 보강' :
                totals.ratio >= 30 ? '⚖️ 적정' :
                totals.ratio >  0  ? '👍 낮음 — 오가닉 강함' : '광고 매출 없음'
              }
              color={
                totals.ratio >= 50 ? '#B45309' :
                totals.ratio >= 30 ? '#A16207' :
                                     '#15803D'
              }
            />
          </div>
        )}

        {showEmpty ? (
          <div className="empty-st" style={{ height: 280 }}>
            <div className="es-ico">{emptyIcon}</div>
            <div className="es-t">{emptyText}</div>
          </div>
        ) : isRev ? (
          /* 매출 모드 — Stacked Bar (오가닉 + 광고) */
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={merged} margin={{ top: 24, right: 20, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#56606E' }}
                interval={Math.max(0, Math.floor(merged.length / 15))}
                angle={-25}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#56606E' }}
                tickFormatter={(v: number) => {
                  if (v >= 100_000_000) return `${(v/100_000_000).toFixed(1)}억`
                  if (v >= 10_000_000) return `${Math.round(v/1_000_000)}백만`
                  if (v >= 10_000) return `${Math.round(v/10_000)}만`
                  return String(v)
                }}
              />
              <Tooltip
                formatter={(v: any, name: string) => [Number(v).toLocaleString('ko-KR') + '원', name]}
                labelFormatter={(label, payload) => {
                  const p: any = payload?.[0]?.payload
                  if (!p) return label
                  return `${p.fullDate} · 광고 의존도 ${p.ratio}%`
                }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine x={todayMD} stroke="#94A3B8" strokeDasharray="3 3" label={{ value: '오늘', fill: '#64748B', fontSize: 10, position: 'top' }} />
              <Bar dataKey="organic" stackId="rev" name="오가닉 매출" fill={COLOR_ORGANIC} />
              <Bar dataKey="adRev" stackId="rev" name="광고 매출" fill={COLOR_AD}>
                <LabelList
                  dataKey="ratio"
                  position="top"
                  fontSize={9}
                  fill="#92400E"
                  formatter={(v: number) => v > 5 ? `${v}%` : ''}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          /* 수량 모드 — 단순 Line */
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={merged} margin={{ top: 8, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} width={45} />
              <Tooltip
                formatter={(v: any) => [Math.round(Number(v)).toLocaleString('ko-KR') + '개', '수량']}
                labelFormatter={l => `날짜: ${l}`}
              />
              <Line
                type="monotone"
                dataKey="qty"
                stroke={COLOR_LINE}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <ReferenceLine x={todayMD} stroke="#94A3B8" strokeDasharray="3 3" label={{ value: '오늘', position: 'top', fontSize: 10, fill: '#64748B', fontWeight: 700 }} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {hasAdData === false && isRev && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#F1F5F9', borderRadius: 6, fontSize: 11, color: '#64748B' }}>
            💡 광고 데이터가 없어 모든 매출이 오가닉으로 표시됩니다. 광고 현황 탭에서 CSV 업로드 시 광고/오가닉 분리가 활성화됩니다.
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 8,
      background: '#fff', border: '1px solid #E4E7EC',
    }}>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

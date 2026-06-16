'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { vatExcluded, VAT_LABEL } from '@/lib/vatUtils'
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis,
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
}

type AdDailyRow = {
  date: string
  ad_cost: number
  revenue_1d: number   // 동일 일자 광고 매출 (VAT 포함 — 여기서 별도 변환)
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

export default function SalesAdOrganicSection({ dailyTrend, chartFrom, chartTo }: Props) {
  const [adRows, setAdRows] = useState<AdDailyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [hasAdData, setHasAdData] = useState<boolean | null>(null)

  // 광고 데이터 로드 (기간 변경 시 재조회)
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
        // VAT 별도 변환
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

  // 날짜별 병합 — 총 매출 + 광고 매출 + 오가닉 매출
  const merged = useMemo(() => {
    const adByDate: Record<string, AdDailyRow> = {}
    adRows.forEach(r => { adByDate[r.date] = r })
    return dailyTrend.map(d => {
      const ad = adByDate[d.fullDate]
      const adRev = ad ? ad.revenue_1d : 0
      const adCost = ad ? ad.ad_cost : 0
      const total = d.rev
      // 오가닉 = 총 매출 - 광고 매출 (음수 방지: 광고 어트리뷰션이 총 매출보다 큰 이상치 케이스)
      const organic = Math.max(0, total - adRev)
      // 음수가 되면 광고만 표시
      const adShown = total >= adRev ? adRev : total
      const ratio = total > 0 ? (adRev / total) * 100 : 0
      return {
        date: d.date,
        fullDate: d.fullDate,
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
    const t = { total: 0, adRev: 0, adCost: 0, organic: 0 }
    merged.forEach(r => {
      t.total += r.total
      t.adRev += r.adRev
      t.adCost += r.adCost
      t.organic += r.organic
    })
    const ratio = t.total > 0 ? (t.adRev / t.total) * 100 : 0
    const roas = t.adCost > 0 ? (t.adRev / t.adCost) * 100 : 0
    return { ...t, ratio, roas }
  }, [merged])

  const todayYmd = (() => {
    const d = new Date()
    return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  })()
  const todayMD = todayYmd.slice(5)

  if (hasAdData === false && adRows.length === 0) {
    // 광고 데이터 자체가 없음 — 안내
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ch">
          <div className="ch-l">
            <div className="ch-ico">📢</div>
            <div>
              <div className="ch-title">광고 매출 vs 오가닉 매출</div>
              <div className="ch-sub">광고 데이터 없음 · 광고 현황 탭에서 CSV 업로드 후 확인 가능</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">📢</div>
          <div>
            <div className="ch-title">광고 매출 vs 오가닉 매출</div>
            <div className="ch-sub">
              동일 일자 광고 전환 기준(1일 어트리뷰션) · {VAT_LABEL} · {chartFrom} ~ {chartTo}
              {loading && ' · 불러오는 중...'}
            </div>
          </div>
        </div>
      </div>
      <div className="cb">
        {/* KPI 카드 4개 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          <KpiCard
            label="총 매출"
            value={fmt(totals.total) + '원'}
            color="#0F172A"
          />
          <KpiCard
            label="광고 매출"
            value={fmt(totals.adRev) + '원'}
            sub={`광고비 ${fmt(totals.adCost)}원 · ROAS ${totals.roas.toFixed(0)}%`}
            color="#F97316"
          />
          <KpiCard
            label="오가닉 매출"
            value={fmt(totals.organic) + '원'}
            sub={`전체의 ${(100 - totals.ratio).toFixed(1)}%`}
            color="#0EA5E9"
          />
          <KpiCard
            label="광고 의존도"
            value={totals.ratio.toFixed(1) + '%'}
            sub={
              totals.ratio >= 50 ? '⚠️ 높음 — 오가닉 보강 필요' :
              totals.ratio >= 30 ? '⚖️ 적정' :
              totals.ratio >  0  ? '👍 낮음 — 오가닉 강함' : '광고 매출 없음'
            }
            color={
              totals.ratio >= 50 ? '#DC2626' :
              totals.ratio >= 30 ? '#D97706' :
              '#059669'
            }
          />
        </div>

        {/* Stacked bar chart */}
        {merged.length > 0 ? (
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
                tickFormatter={v => Number(v).toLocaleString('ko-KR')}
              />
              <Tooltip
                formatter={(v: any, name: string) => [Number(v).toLocaleString('ko-KR') + '원', name]}
                labelFormatter={(label, payload) => {
                  const p = payload?.[0]?.payload
                  if (!p) return label
                  return `${p.fullDate} · 광고 의존도 ${p.ratio}%`
                }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine x={todayMD} stroke="#EF4444" strokeDasharray="3 3" label={{ value: '오늘', fill: '#EF4444', fontSize: 10, position: 'top' }} />
              <Bar dataKey="organic" stackId="rev" name="오가닉 매출" fill="#0EA5E9" />
              <Bar dataKey="adRev" stackId="rev" name="광고 매출" fill="#F97316">
                <LabelList
                  dataKey="ratio"
                  position="top"
                  fontSize={9}
                  fill="#C2410C"
                  formatter={(v: number) => v > 5 ? `${v}%` : ''}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-st" style={{ height: 200 }}>
            <div className="es-ico">📭</div>
            <div className="es-t">기간 내 매출 데이터가 없어요</div>
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

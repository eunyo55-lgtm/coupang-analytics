'use client'
import { useMemo } from 'react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'

interface AdDaily {
  date: string
  ad_cost: number
  revenue_14d: number
  revenue_1d: number
  impressions: number
  clicks: number
}

interface Props {
  csvDailyAll: AdDaily[]
  dateFrom: string  // 'YYYY-MM-DD'
  dateTo: string
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

function diffDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime()
  const b = new Date(to + 'T00:00:00').getTime()
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}
function shiftYMD(ymd: string, deltaDays: number): string {
  const d = new Date(ymd + 'T00:00:00')
  d.setDate(d.getDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

function aggregate(rows: AdDaily[]) {
  return rows.reduce((acc, r) => ({
    ad_cost: acc.ad_cost + Number(r.ad_cost || 0),
    revenue_14d: acc.revenue_14d + Number(r.revenue_14d || 0),
    impressions: acc.impressions + Number(r.impressions || 0),
    clicks: acc.clicks + Number(r.clicks || 0),
  }), { ad_cost: 0, revenue_14d: 0, impressions: 0, clicks: 0 })
}

const changePct = (curr: number, prev: number) =>
  prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : (curr > 0 ? 100 : 0)

type Direction = 'higher_better' | 'lower_better' | 'neutral'

interface SparkCardProps {
  label: string
  ico: string
  value: string
  rawCurr: number
  rawPrev: number
  sparkData: Array<{ date: string; v: number }>
  color: string
  foot?: string
  direction: Direction
  size?: 'big' | 'small'
}

function SparkCard({ label, ico, value, rawCurr, rawPrev, sparkData, color, foot, direction, size = 'big' }: SparkCardProps) {
  const delta = changePct(rawCurr, rawPrev)
  const isUp = delta > 0
  const isDown = delta < 0
  const isGood = direction === 'higher_better' ? isUp : direction === 'lower_better' ? isDown : false
  const isBad  = direction === 'higher_better' ? isDown : direction === 'lower_better' ? isUp : false
  const deltaColor = delta === 0 ? '#94a3b8' : isGood ? '#16a34a' : isBad ? '#dc2626' : '#64748b'
  const arrow = delta === 0 ? '–' : isUp ? '▲' : '▼'

  return (
    <div style={{
      background: 'white', border: '1px solid #e2e8f0', borderLeft: `3px solid ${color}`,
      borderRadius: 8, padding: size === 'big' ? 12 : 10, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{ico} {label}</div>
        <div style={{ fontSize: 10, color: deltaColor, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {arrow} {Math.abs(delta).toFixed(1)}%
        </div>
      </div>
      <div style={{ fontSize: size === 'big' ? 20 : 16, fontWeight: 800, color: '#1e293b', lineHeight: 1.15 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        전 기간 {fmt(rawPrev)}{foot ? ` · ${foot}` : ''}
      </div>
      {size === 'big' && (
        <div style={{ height: 32, marginTop: 4, marginLeft: -6, marginRight: -6 }}>
          {sparkData.length >= 2 ? (
            <ResponsiveContainer>
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ fontSize: 10, color: '#cbd5e1', textAlign: 'center', paddingTop: 10 }}>—</div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 광고 KPI 카드 — 스파크라인 + 전 동일 기간 대비 변동률.
 * 메인 4개 (광고비/광고매출/ROAS/ACoS) + 운영 4개 (노출/클릭/CTR/CPC).
 *
 * 전 기간(prev) = 현재 기간과 동일한 일수만큼 직전 구간.
 *  - 예: 5/01~5/07 → 전 기간 = 4/24~4/30 (7일).
 *
 * 스파크라인 = 전 기간 + 현재 기간 합쳐서 추세 시각화.
 */
export default function AdKpiSparkCards({ csvDailyAll, dateFrom, dateTo }: Props) {
  const periodDays = diffDays(dateFrom, dateTo)
  const prevTo = shiftYMD(dateFrom, -1)
  const prevFrom = shiftYMD(dateFrom, -periodDays)

  const currRows = useMemo(() => csvDailyAll.filter(r => r.date >= dateFrom && r.date <= dateTo), [csvDailyAll, dateFrom, dateTo])
  const prevRows = useMemo(() => csvDailyAll.filter(r => r.date >= prevFrom && r.date <= prevTo), [csvDailyAll, prevFrom, prevTo])
  const sparkRows = useMemo(() => csvDailyAll.filter(r => r.date >= prevFrom && r.date <= dateTo), [csvDailyAll, prevFrom, dateTo])
  const curr = aggregate(currRows)
  const prev = aggregate(prevRows)

  if (csvDailyAll.length === 0) return null

  // Sparkline arrays
  const sparkCost = sparkRows.map(r => ({ date: r.date, v: Number(r.ad_cost || 0) }))
  const sparkRev  = sparkRows.map(r => ({ date: r.date, v: Number(r.revenue_14d || 0) }))
  const sparkRoas = sparkRows.map(r => ({ date: r.date, v: Number(r.ad_cost || 0) > 0 ? Number(r.revenue_14d || 0) / Number(r.ad_cost || 0) * 100 : 0 }))
  const sparkAcos = sparkRows.map(r => ({ date: r.date, v: Number(r.revenue_14d || 0) > 0 ? Number(r.ad_cost || 0) / Number(r.revenue_14d || 0) * 100 : 0 }))
  const sparkCtr  = sparkRows.map(r => ({ date: r.date, v: Number(r.impressions || 0) > 0 ? Number(r.clicks || 0) / Number(r.impressions || 0) * 100 : 0 }))
  const sparkCpc  = sparkRows.map(r => ({ date: r.date, v: Number(r.clicks || 0) > 0 ? Number(r.ad_cost || 0) / Number(r.clicks || 0) : 0 }))

  // Derived
  const currRoas = curr.ad_cost > 0 ? curr.revenue_14d / curr.ad_cost : 0
  const prevRoas = prev.ad_cost > 0 ? prev.revenue_14d / prev.ad_cost : 0
  const currAcos = curr.revenue_14d > 0 ? curr.ad_cost / curr.revenue_14d * 100 : 0
  const prevAcos = prev.revenue_14d > 0 ? prev.ad_cost / prev.revenue_14d * 100 : 0
  const currCtr  = curr.impressions > 0 ? curr.clicks / curr.impressions * 100 : 0
  const prevCtr  = prev.impressions > 0 ? prev.clicks / prev.impressions * 100 : 0
  const currCpc  = curr.clicks > 0 ? curr.ad_cost / curr.clicks : 0
  const prevCpc  = prev.clicks > 0 ? prev.ad_cost / prev.clicks : 0

  const dailyAvgCost = curr.ad_cost / periodDays
  const dailyAvgRev  = curr.revenue_14d / periodDays
  const roasGoal = 5
  const roasGoalDiff = (currRoas - roasGoal) * 100
  const roasColor = currRoas >= 5 ? '#16a34a' : currRoas >= 2 ? '#f59e0b' : '#dc2626'

  return (
    <div style={{ marginBottom: 12 }}>
      {/* 비교 기간 안내 */}
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
        📊 현재 기간 <b>{dateFrom} ~ {dateTo}</b> ({periodDays}일) ·
        전 기간 <b>{prevFrom} ~ {prevTo}</b> 비교
      </div>

      {/* 메인 4개 (스파크라인 포함) */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 8, marginBottom: 8,
      }}>
        <SparkCard
          label="광고비" ico="💸"
          value={fmt(curr.ad_cost) + '원'}
          rawCurr={curr.ad_cost} rawPrev={prev.ad_cost}
          sparkData={sparkCost} color="#ef4444"
          foot={`일평균 ${fmt(dailyAvgCost)}원`}
          direction="neutral"
        />
        <SparkCard
          label="광고매출 (14일)" ico="📣"
          value={fmt(curr.revenue_14d) + '원'}
          rawCurr={curr.revenue_14d} rawPrev={prev.revenue_14d}
          sparkData={sparkRev} color="#2563eb"
          foot={`일평균 ${fmt(dailyAvgRev)}원`}
          direction="higher_better"
        />
        <SparkCard
          label="ROAS" ico="📈"
          value={(currRoas * 100).toFixed(0) + '%'}
          rawCurr={currRoas * 100} rawPrev={prevRoas * 100}
          sparkData={sparkRoas} color={roasColor}
          foot={`목표 500% ${roasGoalDiff >= 0 ? '+' : ''}${roasGoalDiff.toFixed(0)}%p`}
          direction="higher_better"
        />
        <SparkCard
          label="ACoS" ico="🎯"
          value={currAcos.toFixed(1) + '%'}
          rawCurr={currAcos} rawPrev={prevAcos}
          sparkData={sparkAcos} color="#a855f7"
          foot="광고비/매출"
          direction="lower_better"
        />
      </div>

      {/* 운영 지표 4개 (스파크라인 없는 컴팩트 카드) */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 8,
      }}>
        <SparkCard
          label="노출수" ico="👀"
          value={fmt(curr.impressions)}
          rawCurr={curr.impressions} rawPrev={prev.impressions}
          sparkData={[]} color="#0891b2"
          direction="higher_better" size="small"
        />
        <SparkCard
          label="클릭수" ico="👆"
          value={fmt(curr.clicks)}
          rawCurr={curr.clicks} rawPrev={prev.clicks}
          sparkData={[]} color="#0891b2"
          direction="higher_better" size="small"
        />
        <SparkCard
          label="CTR" ico="🎯"
          value={currCtr.toFixed(2) + '%'}
          rawCurr={currCtr} rawPrev={prevCtr}
          sparkData={sparkCtr} color="#10b981"
          direction="higher_better" size="small"
        />
        <SparkCard
          label="CPC" ico="💵"
          value={fmt(currCpc) + '원'}
          rawCurr={currCpc} rawPrev={prevCpc}
          sparkData={sparkCpc} color="#f59e0b"
          direction="lower_better" size="small"
        />
      </div>
    </div>
  )
}

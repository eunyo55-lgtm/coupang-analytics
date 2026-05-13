'use client'
import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { supabase } from '@/lib/supabase'

interface AdDaily {
  date: string
  ad_cost: number
  revenue_14d: number
  revenue_1d: number
  impressions: number
  clicks: number
  orders_14d?: number  // 옵션 (구 뷰에는 없을 수 있음)
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
  // ⚠️ toISOString()은 UTC라서 KST(UTC+9) 환경에선 하루 밀려나옴.
  // 로컬 날짜 컴포넌트를 직접 조립해 타임존 영향 없게 만든다.
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + deltaDays)
  const yyyy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function aggregate(rows: AdDaily[]) {
  return rows.reduce((acc, r) => ({
    ad_cost: acc.ad_cost + Number(r.ad_cost || 0),
    revenue_14d: acc.revenue_14d + Number(r.revenue_14d || 0),
    impressions: acc.impressions + Number(r.impressions || 0),
    clicks: acc.clicks + Number(r.clicks || 0),
    orders_14d: acc.orders_14d + Number(r.orders_14d || 0),
  }), { ad_cost: 0, revenue_14d: 0, impressions: 0, clicks: 0, orders_14d: 0 })
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
 *  메인 5개: 광고비/광고매출/ROAS/ACoS/광고의존도
 *  운영 5개: 노출/클릭/CTR/CPC/CPA
 *
 * 광고 의존도 = 광고매출(14일) / 전체매출 — sales_data RPC 결합 필요
 *  RPC 미설치 시 카드 숨김
 */
export default function AdKpiSparkCards({ csvDailyAll, dateFrom, dateTo }: Props) {
  const periodDays = diffDays(dateFrom, dateTo)
  const prevTo = shiftYMD(dateFrom, -1)
  const prevFrom = shiftYMD(dateFrom, -periodDays)

  // 전체매출 (sales_data) - RPC 로드
  type SalesDaily = { sale_date: string; total_revenue: number }
  const [salesDaily, setSalesDaily] = useState<SalesDaily[]>([])
  const [salesRpcAvailable, setSalesRpcAvailable] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      try {
        const { data, error } = await supabase
          .rpc('get_daily_revenue_range', { p_date_from: prevFrom, p_date_to: dateTo })
        if (cancelled) return
        if (error) {
          console.warn('[AdKpiSparkCards] get_daily_revenue_range missing:', error.message)
          setSalesRpcAvailable(false)
          return
        }
        setSalesDaily((data as SalesDaily[]) || [])
      } catch (e) {
        if (!cancelled) setSalesRpcAvailable(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [prevFrom, dateTo])

  const currRows = useMemo(() => csvDailyAll.filter(r => r.date >= dateFrom && r.date <= dateTo), [csvDailyAll, dateFrom, dateTo])
  const prevRows = useMemo(() => csvDailyAll.filter(r => r.date >= prevFrom && r.date <= prevTo), [csvDailyAll, prevFrom, prevTo])
  const sparkRows = useMemo(() => csvDailyAll.filter(r => r.date >= prevFrom && r.date <= dateTo), [csvDailyAll, prevFrom, dateTo])
  const curr = aggregate(currRows)
  const prev = aggregate(prevRows)

  // 전체매출 합계 (광고 의존도용)
  const totalRevCurr = salesDaily.filter(s => s.sale_date >= dateFrom && s.sale_date <= dateTo).reduce((s, r) => s + Number(r.total_revenue || 0), 0)
  const totalRevPrev = salesDaily.filter(s => s.sale_date >= prevFrom && s.sale_date <= prevTo).reduce((s, r) => s + Number(r.total_revenue || 0), 0)

  if (csvDailyAll.length === 0) return null

  // Sparklines
  const sparkCost = sparkRows.map(r => ({ date: r.date, v: Number(r.ad_cost || 0) }))
  const sparkRev  = sparkRows.map(r => ({ date: r.date, v: Number(r.revenue_14d || 0) }))
  const sparkRoas = sparkRows.map(r => ({ date: r.date, v: Number(r.ad_cost || 0) > 0 ? Number(r.revenue_14d || 0) / Number(r.ad_cost || 0) * 100 : 0 }))
  const sparkAcos = sparkRows.map(r => ({ date: r.date, v: Number(r.revenue_14d || 0) > 0 ? Number(r.ad_cost || 0) / Number(r.revenue_14d || 0) * 100 : 0 }))
  const sparkCtr  = sparkRows.map(r => ({ date: r.date, v: Number(r.impressions || 0) > 0 ? Number(r.clicks || 0) / Number(r.impressions || 0) * 100 : 0 }))
  const sparkCpc  = sparkRows.map(r => ({ date: r.date, v: Number(r.clicks || 0) > 0 ? Number(r.ad_cost || 0) / Number(r.clicks || 0) : 0 }))
  const sparkCpa  = sparkRows.map(r => ({ date: r.date, v: Number(r.orders_14d || 0) > 0 ? Number(r.ad_cost || 0) / Number(r.orders_14d || 0) : 0 }))
  // 광고 의존도 스파크라인 — 일별로 광고매출/전체매출
  const revMapByDate = new Map(salesDaily.map(s => [s.sale_date, Number(s.total_revenue || 0)]))
  const sparkDep = sparkRows.map(r => {
    const total = revMapByDate.get(r.date) || 0
    return { date: r.date, v: total > 0 ? Number(r.revenue_14d || 0) / total * 100 : 0 }
  })

  // Derived
  const currRoas = curr.ad_cost > 0 ? curr.revenue_14d / curr.ad_cost : 0
  const prevRoas = prev.ad_cost > 0 ? prev.revenue_14d / prev.ad_cost : 0
  const currAcos = curr.revenue_14d > 0 ? curr.ad_cost / curr.revenue_14d * 100 : 0
  const prevAcos = prev.revenue_14d > 0 ? prev.ad_cost / prev.revenue_14d * 100 : 0
  const currCtr  = curr.impressions > 0 ? curr.clicks / curr.impressions * 100 : 0
  const prevCtr  = prev.impressions > 0 ? prev.clicks / prev.impressions * 100 : 0
  const currCpc  = curr.clicks > 0 ? curr.ad_cost / curr.clicks : 0
  const prevCpc  = prev.clicks > 0 ? prev.ad_cost / prev.clicks : 0
  const currCpa  = curr.orders_14d > 0 ? curr.ad_cost / curr.orders_14d : 0
  const prevCpa  = prev.orders_14d > 0 ? prev.ad_cost / prev.orders_14d : 0
  // 광고 의존도
  const currDep  = totalRevCurr > 0 ? curr.revenue_14d / totalRevCurr * 100 : 0
  const prevDep  = totalRevPrev > 0 ? prev.revenue_14d / totalRevPrev * 100 : 0

  const dailyAvgCost = curr.ad_cost / periodDays
  const dailyAvgRev  = curr.revenue_14d / periodDays
  const roasGoal = 5
  const roasGoalDiff = (currRoas - roasGoal) * 100
  const roasColor = currRoas >= 5 ? '#16a34a' : currRoas >= 2 ? '#f59e0b' : '#dc2626'
  // 광고 의존도 색상: 낮을수록 좋음 (자연검색 비중 큼)
  const depColor = currDep >= 50 ? '#dc2626' : currDep >= 20 ? '#f59e0b' : '#16a34a'
  const depFootText = currDep >= 50 ? '광고 의존 매우 높음 — 자연 노출 강화 필요'
                    : currDep >= 20 ? '광고 의존 보통'
                    : currDep >  0  ? '자연 노출 비중 큼 (좋음)'
                    : '전체 매출 없음'
  const hasOrdersData = csvDailyAll.some(r => r.orders_14d !== undefined && r.orders_14d !== null)

  return (
    <div style={{ marginBottom: 12 }}>
      {/* 비교 기간 안내 */}
      <div
        style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}
        title={`▲▼는 "직전 동일 기간" 대비 변동률입니다.\n선택한 기간이 ${periodDays}일이므로, 그 직전 ${periodDays}일을 비교 대상으로 잡았습니다.\n예: 5/1~5/7 선택 → 4/24~4/30과 비교 (지난 7일 vs 그 전 7일).`}
      >
        📊 현재 기간 <b>{dateFrom} ~ {dateTo}</b> ({periodDays}일) ·
        ▲▼ 비교 대상 <b>{prevFrom} ~ {prevTo}</b> (직전 동일 {periodDays}일)
        <span style={{ marginLeft: 6, color: '#cbd5e1', cursor: 'help' }}>ⓘ</span>
      </div>

      {/* 메인 5개 — auto-fit grid로 화면폭에 맞춰 wrap */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
        {salesRpcAvailable && (
          <SparkCard
            label="광고 의존도" ico="🔗"
            value={currDep.toFixed(1) + '%'}
            rawCurr={currDep} rawPrev={prevDep}
            sparkData={sparkDep} color={depColor}
            foot={depFootText}
            direction="lower_better"
          />
        )}
      </div>

      {!salesRpcAvailable && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 8, fontStyle: 'italic' }}>
          ⓘ 광고 의존도 카드 표시: Supabase에 <code>get_daily_revenue_range</code> RPC 설치 필요
        </div>
      )}

      {/* 운영 지표 5개 (CTR/CPC/CPA는 스파크라인 포함) */}
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
        {hasOrdersData && (
          <SparkCard
            label="CPA (주문당 광고비)" ico="🛒"
            value={curr.orders_14d > 0 ? fmt(currCpa) + '원' : '–'}
            rawCurr={currCpa} rawPrev={prevCpa}
            sparkData={sparkCpa} color="#7c3aed"
            foot={`${fmt(curr.orders_14d)}건 주문`}
            direction="lower_better" size="small"
          />
        )}
      </div>
    </div>
  )
}

'use client'
import { useMemo } from 'react'

interface AdDaily {
  date: string
  ad_cost: number
  revenue_14d: number
  orders_14d?: number
}

interface Props {
  csvDailyAll: AdDaily[]
}

/**
 * 광고 데이터의 가장 최신 일자를 기준으로:
 *   ⏰ 전일 (어제) vs 그제
 *   📅 주간 (최근 7일) vs 그 직전 7일
 * 을 항상 보여주는 스냅샷 카드.
 *
 * dateRange와 무관하게 항상 동일한 의미 — 사용자 dateRange가 바뀌어도
 * "어제는 어제, 주간은 최근 7일"로 일관된 비교를 제공.
 *
 * "최신" 기준은 csvDailyAll 마지막 row의 date (보통 어제까지 데이터).
 */
export default function AdSnapshotCards({ csvDailyAll }: Props) {
  const snap = useMemo(() => {
    if (csvDailyAll.length === 0) return null
    // csvDailyAll은 date asc 정렬되어 있다고 가정 (AdPage에서 load 시 order)
    const sorted = [...csvDailyAll].sort((a, b) => a.date.localeCompare(b.date))
    const latestDate = sorted[sorted.length - 1].date
    const byDate = new Map(sorted.map(r => [r.date, r]))

    const dayBefore = shiftYMD(latestDate, -1)
    const yest = byDate.get(latestDate)
    const prev = byDate.get(dayBefore)

    const last7Start = shiftYMD(latestDate, -6)
    const prev7End = shiftYMD(latestDate, -7)
    const prev7Start = shiftYMD(latestDate, -13)

    const last7 = sorted.filter(r => r.date >= last7Start && r.date <= latestDate)
    const prev7 = sorted.filter(r => r.date >= prev7Start && r.date <= prev7End)

    const sumOf = (rows: AdDaily[]) => ({
      cost: rows.reduce((s, r) => s + Number(r.ad_cost || 0), 0),
      rev:  rows.reduce((s, r) => s + Number(r.revenue_14d || 0), 0),
    })

    return {
      latestDate, dayBefore, last7Start, prev7Start, prev7End,
      yest: yest ? { cost: Number(yest.ad_cost || 0), rev: Number(yest.revenue_14d || 0) } : { cost: 0, rev: 0 },
      prev: prev ? { cost: Number(prev.ad_cost || 0), rev: Number(prev.revenue_14d || 0) } : { cost: 0, rev: 0 },
      last7: sumOf(last7),
      prev7: sumOf(prev7),
      hasYesterdayPrev: !!prev,
      hasPrev7: prev7.length > 0,
    }
  }, [csvDailyAll])

  if (!snap) return null

  const yestRoas  = snap.yest.cost  > 0 ? snap.yest.rev  / snap.yest.cost  * 100 : 0
  const prevRoas  = snap.prev.cost  > 0 ? snap.prev.rev  / snap.prev.cost  * 100 : 0
  const last7Roas = snap.last7.cost > 0 ? snap.last7.rev / snap.last7.cost * 100 : 0
  const prev7Roas = snap.prev7.cost > 0 ? snap.prev7.rev / snap.prev7.cost * 100 : 0

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: 8, marginBottom: 12,
    }}>
      <SnapCard
        title="⏰ 전일 (가장 최신)"
        currLabel={snap.latestDate}
        prevLabel={snap.dayBefore}
        currCost={snap.yest.cost} prevCost={snap.prev.cost}
        currRev={snap.yest.rev}   prevRev={snap.prev.rev}
        currRoas={yestRoas}        prevRoas={prevRoas}
        hasPrev={snap.hasYesterdayPrev}
        accent="#2563eb"
        compareNote={`vs ${snap.dayBefore} (그제) — 전일 대비 추세`}
      />
      <SnapCard
        title="📅 주간 (최근 7일)"
        currLabel={`${snap.last7Start} ~ ${snap.latestDate}`}
        prevLabel={`${snap.prev7Start} ~ ${snap.prev7End}`}
        currCost={snap.last7.cost} prevCost={snap.prev7.cost}
        currRev={snap.last7.rev}    prevRev={snap.prev7.rev}
        currRoas={last7Roas}         prevRoas={prev7Roas}
        hasPrev={snap.hasPrev7}
        accent="#10b981"
        compareNote={`vs 그 직전 7일 (${snap.prev7Start} ~ ${snap.prev7End}) — 주간 추세`}
      />
    </div>
  )
}

interface SnapProps {
  title: string
  currLabel: string
  prevLabel: string
  currCost: number; prevCost: number
  currRev: number;  prevRev: number
  currRoas: number; prevRoas: number
  hasPrev: boolean
  accent: string
  compareNote: string
}

function SnapCard(p: SnapProps) {
  const roasColor = p.currRoas >= 500 ? '#16a34a' : p.currRoas >= 200 ? '#f59e0b' : p.currRoas > 0 ? '#dc2626' : '#94a3b8'
  return (
    <div style={{
      background: 'white', border: '1px solid #e2e8f0',
      borderTop: `3px solid ${p.accent}`,
      borderRadius: 8, padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{p.title}</div>
        <div style={{ fontSize: 10, color: '#64748b' }}>{p.currLabel}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
        <Metric label="광고비"    value={fmt(p.currCost) + '원'} curr={p.currCost} prev={p.prevCost} direction="neutral"       hasPrev={p.hasPrev} />
        <Metric label="광고매출"  value={fmt(p.currRev)  + '원'} curr={p.currRev}  prev={p.prevRev}  direction="higher_better" hasPrev={p.hasPrev} />
        <Metric label="ROAS"      value={p.currRoas.toFixed(0) + '%'} curr={p.currRoas} prev={p.prevRoas} direction="higher_better" usePoint suffix="%p" valueColor={roasColor} hasPrev={p.hasPrev} />
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', borderTop: '1px solid #f1f5f9', paddingTop: 6, lineHeight: 1.55 }}>
        {p.hasPrev ? (
          <>
            <div>{p.compareNote}</div>
            <div style={{ marginTop: 2 }}>
              비교값: 광고비 {fmt(p.prevCost)}원 · 매출 {fmt(p.prevRev)}원 · ROAS {p.prevRoas.toFixed(0)}%
            </div>
          </>
        ) : (
          <div style={{ color: '#dc2626' }}>⚠️ 비교 기간({p.prevLabel}) 데이터가 없어 추세 계산 불가</div>
        )}
      </div>
    </div>
  )
}

interface MetricProps {
  label: string
  value: string
  curr: number
  prev: number
  direction: 'higher_better' | 'lower_better' | 'neutral'
  usePoint?: boolean    // true면 percentage point (단순 차이)
  suffix?: string       // 기본 '%'
  valueColor?: string
  hasPrev: boolean
}

function Metric({ label, value, curr, prev, direction, usePoint = false, suffix = '%', valueColor, hasPrev }: MetricProps) {
  // 변동 계산
  const delta = usePoint
    ? (curr - prev)
    : (prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0))
  const isUp = delta > 0
  const isDown = delta < 0
  const isGood = direction === 'higher_better' ? isUp : direction === 'lower_better' ? isDown : false
  const isBad  = direction === 'higher_better' ? isDown : direction === 'lower_better' ? isUp : false
  const color = !hasPrev ? '#cbd5e1'
              : Math.abs(delta) < 0.1 ? '#94a3b8'
              : isGood ? '#16a34a' : isBad ? '#dc2626' : '#64748b'
  const arrow = !hasPrev || Math.abs(delta) < 0.1 ? '–' : isUp ? '▲' : '▼'
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: valueColor || '#1e293b', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color, fontWeight: 700, marginTop: 2 }}>
        {arrow} {hasPrev ? Math.abs(delta).toFixed(1) + suffix : '비교불가'}
      </div>
    </div>
  )
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

function shiftYMD(ymd: string, deltaDays: number): string {
  // 로컬 날짜 컴포넌트 기반 — 타임존 영향 없음
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + deltaDays)
  const yyyy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

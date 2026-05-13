'use client'
import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { supabase } from '@/lib/supabase'

interface Props {
  latestDate: string
  daily26: { date: string; qty: number }[]
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
const fmtShort = (n: number) =>
  n >= 100_000_000 ? (n / 100_000_000).toFixed(1) + '억'
  : n >= 10_000_000 ? (n / 10_000_000).toFixed(1) + '천만'
  : n >= 10_000 ? (n / 10_000).toFixed(0) + '만'
  : Math.round(n).toLocaleString('ko-KR')

function shiftDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
}

function go(href: string) {
  const nav = (window as Record<string, unknown>).navigateTo as ((p: string) => void) | undefined
  if (nav) nav(href)
  else window.location.href = href
}

interface MiniCardProps {
  icon: string
  label: string
  value: string
  subLabel: string
  data: Array<{ date: string; v: number }>
  color: string
  href: string
}

function MiniCard({ icon, label, value, subLabel, data, color, href }: MiniCardProps) {
  return (
    <div
      onClick={() => go(href)}
      style={{
        background: 'white', border: '1px solid #e2e8f0', borderTop: `3px solid ${color}`,
        borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'transform 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}
    >
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 2 }}>{icon} {label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{subLabel}</div>
      <div style={{ height: 36, marginTop: 6, marginLeft: -6, marginRight: -6 }}>
        {data.length >= 2 ? (
          <ResponsiveContainer>
            <LineChart data={data}>
              <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ fontSize: 10, color: '#cbd5e1', textAlign: 'center', paddingTop: 12 }}>14일 데이터 부족</div>
        )}
      </div>
    </div>
  )
}

/**
 * 4개 핵심 지표의 14일 추세 — 미니 스파크라인 카드.
 *  1) 판매 수량 (state.daily26)
 *  2) 광고비 (coupang_ad_daily_summary)
 *  3) ROAS (coupang_ad_daily_summary)
 *  4) 추적 키워드 검색량 합계 (keyword_search_volumes)
 * 클릭 시 해당 탭으로 이동.
 */
export default function DashboardTrendStrip({ latestDate, daily26 }: Props) {
  type AdDay = { date: string; ad_cost: number; revenue_14d: number }
  type Vol = { keyword: string; target_date: string; total_volume: number }
  const [adRows, setAdRows] = useState<AdDay[]>([])
  const [volRows, setVolRows] = useState<Vol[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase || !latestDate) return
      const since = shiftDays(latestDate, -13)
      try {
        const [adRes, volRes] = await Promise.all([
          supabase.from('coupang_ad_daily_summary')
            .select('date, ad_cost, revenue_14d')
            .gte('date', since)
            .lte('date', latestDate)
            .order('date', { ascending: true }),
          supabase.from('keyword_search_volumes')
            .select('keyword, target_date, total_volume')
            .gte('target_date', since)
            .lte('target_date', latestDate),
        ])
        if (cancelled) return
        if (adRes.data) setAdRows(adRes.data as AdDay[])
        if (volRes.data) setVolRows(volRes.data as Vol[])
      } catch (e) {
        console.warn('[DashboardTrendStrip]', e)
      }
    }
    load()
    return () => { cancelled = true }
  }, [latestDate])

  // 14일 매출 (daily26 마지막 14일)
  const salesData = useMemo(() => {
    if (!latestDate) return [] as Array<{ date: string; v: number }>
    const since = shiftDays(latestDate, -13)
    return daily26
      .filter(r => r.date >= since && r.date <= latestDate)
      .map(r => ({ date: r.date, v: Number(r.qty || 0) }))
  }, [daily26, latestDate])

  const adCostData = useMemo(() =>
    adRows.map(r => ({ date: r.date, v: Number(r.ad_cost || 0) })),
    [adRows]
  )
  const roasData = useMemo(() =>
    adRows.map(r => ({
      date: r.date,
      v: Number(r.ad_cost || 0) > 0 ? Number(r.revenue_14d || 0) / Number(r.ad_cost || 0) * 100 : 0,
    })),
    [adRows]
  )
  const volByDate = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const r of volRows) {
      acc[r.target_date] = (acc[r.target_date] || 0) + Number(r.total_volume || 0)
    }
    return Object.entries(acc)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, v }))
  }, [volRows])

  // 최신값 / 기간 합계
  const latestSalesQty = salesData[salesData.length - 1]?.v || 0
  const last14Cost = adCostData.reduce((s, r) => s + r.v, 0)
  const latestRoas = roasData[roasData.length - 1]?.v || 0
  const latestVolSum = volByDate[volByDate.length - 1]?.v || 0

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
        📊 14일 추세 <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 11 }}>· 카드 클릭 시 상세 탭으로 이동</span>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8,
      }}>
        <MiniCard
          icon="🛒" label="일 판매 수량"
          value={fmt(latestSalesQty) + '개'}
          subLabel={`최신 (${latestDate.slice(5)})`}
          data={salesData} color="#1D4ED8"
          href="/sales"
        />
        <MiniCard
          icon="💸" label="일 광고비"
          value={fmtShort(adCostData[adCostData.length - 1]?.v || 0) + '원'}
          subLabel={`14일 합 ${fmtShort(last14Cost)}원`}
          data={adCostData} color="#ef4444"
          href="/ad"
        />
        <MiniCard
          icon="📈" label="일 ROAS"
          value={latestRoas.toFixed(0) + '%'}
          subLabel={latestRoas >= 500 ? '✅ 목표 달성' : latestRoas >= 200 ? '⚠️ 목표 미달' : '🔴 효율 저조'}
          data={roasData} color={latestRoas >= 500 ? '#16a34a' : latestRoas >= 200 ? '#f59e0b' : '#dc2626'}
          href="/ad"
        />
        <MiniCard
          icon="🔍" label="추적 키워드 검색량 합계"
          value={fmt(latestVolSum) + '/일'}
          subLabel={`${volByDate.length}일치 수집`}
          data={volByDate} color="#7c3aed"
          href="/ranking"
        />
      </div>
    </div>
  )
}

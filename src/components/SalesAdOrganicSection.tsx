'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { vatExcluded, VAT_LABEL } from '@/lib/vatUtils'
import { readSwrCache, writeSwrCache } from '@/lib/swrCache'
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis,
  Tooltip, Legend, ReferenceLine, LabelList,
} from 'recharts'

const AD_CACHE_TTL = 4 * 60 * 60 * 1000  // 4시간

type DailyTrend = {
  date: string
  fullDate: string
  qty: number
  rev: number  // 판매가 매출 (sale_price × qty, VAT 별도)
}

type Props = {
  dailyTrend: DailyTrend[]
  chartFrom: string
  chartTo: string
  mode: 'qty' | 'rev'
  salesDataLoading: boolean
}

type AdAggRow = {
  date: string
  units: number
  adCost: number
  adRev: number   // revenue_14d (판매가)
}

// 다른 탭과 통일된 팔레트 (season/category 차트와 같은 톤)
const COLOR_ORGANIC = '#3B82F6'  // 메인 블루 (오가닉)
const COLOR_AD      = '#F59E0B'  // 앰버 (광고)

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

export default function SalesAdOrganicSection({
  dailyTrend, chartFrom, chartTo, salesDataLoading,
}: Props) {
  const [attrWindow, setAttrWindow] = useState<'1d' | '14d'>('14d')

  // SWR 캐시 — 같은 기간+윈도우면 즉시 표시 + 백그라운드 갱신
  const cacheKey = `swr_sales_ad_${attrWindow}_${chartFrom}_${chartTo}`
  type CachedAd = { rows: Array<[string, AdAggRow]>; lastUploadDate: string | null }
  const _cached = (typeof window !== 'undefined' && chartFrom && chartTo)
    ? readSwrCache<CachedAd>(cacheKey, AD_CACHE_TTL)
    : null
  const _initialAgg = _cached ? new Map(_cached.data.rows) : new Map<string, AdAggRow>()

  const [adAgg, setAdAgg] = useState<Map<string, AdAggRow>>(_initialAgg)
  const [adLoading, setAdLoading] = useState(_initialAgg.size === 0)
  const [hasAdData, setHasAdData] = useState<boolean | null>(_initialAgg.size > 0 ? true : null)
  const [lastUploadDate, setLastUploadDate] = useState<string | null>(_cached?.data.lastUploadDate ?? null)

  useEffect(() => {
    let cancelled = false
    if (!chartFrom || !chartTo) return
    // 캐시 fresh → fetch 생략
    const cached = readSwrCache<CachedAd>(cacheKey, AD_CACHE_TTL)
    if (cached) {
      setAdAgg(new Map(cached.data.rows))
      setHasAdData(cached.data.rows.length > 0)
      setLastUploadDate(cached.data.lastUploadDate)
      setAdLoading(false)
      if (!cached.stale) return  // 신선하면 백그라운드 fetch 생략
    } else {
      setAdLoading(true)
    }
    async function load() {
      if (!supabase) return
      try {
        const PAGE = 1000
        const agg = new Map<string, AdAggRow>()
        let from = 0
        let totalFetched = 0
        while (true) {
          const { data, error } = await supabase
            .from('coupang_ad_daily')
            .select('date, units_1d, units_14d, revenue_1d, revenue_14d, ad_cost')
            .gte('date', chartFrom)
            .lte('date', chartTo)
            .order('date', { ascending: true })
            .range(from, from + PAGE - 1)
          if (cancelled) return
          if (error) break
          const rows = (data || []) as any[]
          for (const r of rows) {
            const date = String(r.date)
            const cur = agg.get(date) || { date, units: 0, adCost: 0, adRev: 0 }
            const units = attrWindow === '14d' ? Number(r.units_14d || 0) : Number(r.units_1d || 0)
            const rev = attrWindow === '14d' ? Number(r.revenue_14d || 0) : Number(r.revenue_1d || 0)
            cur.units += units
            cur.adRev += vatExcluded(rev)
            cur.adCost += vatExcluded(Number(r.ad_cost || 0))
            agg.set(date, cur)
          }
          totalFetched += rows.length
          if (rows.length < PAGE) break
          from += PAGE
          if (totalFetched > 100000) break
        }
        if (cancelled) return
        setAdAgg(agg)
        setHasAdData(agg.size > 0)
        let lastDate: string | null = null
        if (agg.size > 0) {
          const dates = Array.from(agg.keys()).sort()
          lastDate = dates[dates.length - 1]
          setLastUploadDate(lastDate)
        }
        // 캐시 저장
        writeSwrCache(cacheKey, { rows: Array.from(agg.entries()), lastUploadDate: lastDate })
      } catch { if (!cancelled) { setAdAgg(new Map()); setHasAdData(false) } }
      finally { if (!cancelled) setAdLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [chartFrom, chartTo, attrWindow, cacheKey])

  // 병합 — 광고 매출은 CSV의 판매가 그대로 사용 (수량 비율 추정 X)
  const merged = useMemo(() => {
    return dailyTrend.map(d => {
      const ad = adAgg.get(d.fullDate)
      const adRev   = ad ? ad.adRev : 0
      const adCost  = ad ? ad.adCost : 0
      const adUnits = ad ? ad.units : 0
      const total = d.rev
      const adShown = Math.min(total, adRev)  // 광고가 총 매출 초과하면 캡
      const organic = Math.max(0, total - adShown)
      const ratio = total > 0 ? (adShown / total) * 100 : 0
      return {
        date: d.date,
        fullDate: d.fullDate,
        qty: d.qty,
        adUnits,
        total,
        adRev: adShown,
        adCost,
        organic,
        ratio: Math.round(ratio * 10) / 10,
      }
    })
  }, [dailyTrend, adAgg])

  const totals = useMemo(() => {
    const t = { total: 0, adRev: 0, adCost: 0, organic: 0, adUnits: 0, qty: 0 }
    merged.forEach(r => {
      t.total += r.total
      t.adRev += r.adRev
      t.adCost += r.adCost
      t.organic += r.organic
      t.adUnits += r.adUnits
      t.qty += r.qty
    })
    const ratio = t.total > 0 ? (t.adRev / t.total) * 100 : 0
    const roas = t.adCost > 0 ? (t.adRev / t.adCost) * 100 : 0
    // 광고비 비중 = 광고비 / 총 매출 (작을수록 효율적)
    const adCostRatio = t.total > 0 ? (t.adCost / t.total) * 100 : 0
    return { ...t, ratio, roas, adCostRatio }
  }, [merged])

  const todayMD = (() => {
    const t = new Date()
    return `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`
  })()

  // 통합 로딩 상태 — 모든 데이터 준비될 때까지 일관된 표시
  const allLoading = salesDataLoading || adLoading
  const showEmpty = !allLoading && merged.length === 0

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">📈</div>
          <div>
            <div className="ch-title">일별 판매 추이 (판매가 · 광고 vs 오가닉)</div>
            <div className="ch-sub">
              {chartFrom} ~ {chartTo}
              {` · ${attrWindow === '14d' ? '14일' : '1일'} 어트리뷰션`}
              {` · ${VAT_LABEL}`}
              {lastUploadDate && ` · 광고 CSV 최신: ${lastUploadDate}`}
            </div>
          </div>
        </div>
        {!allLoading && hasAdData && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 4 }}>어트리뷰션:</span>
            {(['14d', '1d'] as const).map(w => (
              <button
                key={w}
                onClick={() => setAttrWindow(w)}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700,
                  border: '1px solid ' + (attrWindow === w ? '#475569' : '#E4E7EC'),
                  background: attrWindow === w ? '#475569' : '#fff',
                  color: attrWindow === w ? '#fff' : 'var(--t2)',
                  borderRadius: 4, cursor: 'pointer',
                }}
              >{w === '14d' ? '14일' : '1일'}</button>
            ))}
          </div>
        )}
      </div>
      <div className="cb">
        {/* 3 카드 × 2줄 — 통합 로딩 (스켈레톤) */}
        {/* Row 1: 매출 분포 (광고 vs 오가닉) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          {allLoading ? (
            Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={`r1-${i}`} />)
          ) : (
            <>
              <KpiCard
                label="총 매출"
                value={fmt(totals.total) + '원'}
                sub={`${totals.qty.toLocaleString()}개 판매`}
                color="#0F172A"
              />
              <KpiCard
                label="광고 전환 매출"
                value={fmt(totals.adRev) + '원'}
                sub={hasAdData
                  ? `전체의 ${totals.ratio.toFixed(1)}% · ${totals.adUnits.toLocaleString()}개 판매`
                  : '광고 데이터 없음'}
                color={COLOR_AD}
              />
              <KpiCard
                label="오가닉 매출"
                value={fmt(totals.organic) + '원'}
                sub={hasAdData
                  ? `전체의 ${(100 - totals.ratio).toFixed(1)}%`
                  : '전체 매출 (광고 데이터 없음)'}
                color={COLOR_ORGANIC}
              />
            </>
          )}
        </div>
        {/* Row 2: 광고 효율 (광고비 · 비중 · ROAS) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
          {allLoading ? (
            Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={`r2-${i}`} />)
          ) : (
            <>
              <KpiCard
                label="광고비"
                value={hasAdData ? fmt(totals.adCost) + '원' : '—'}
                sub={hasAdData ? VAT_LABEL : ''}
                color="#DC2626"
              />
              <KpiCard
                label="광고비 비중"
                value={hasAdData ? totals.adCostRatio.toFixed(2) + '%' : '—'}
                sub={
                  !hasAdData ? '' :
                  totals.adCostRatio < 5  ? '🏆 매우 효율적' :
                  totals.adCostRatio < 10 ? '👍 효율적' :
                  totals.adCostRatio < 15 ? '⚖️ 보통' :
                                            '⚠️ 부담스러움'
                }
                color="#7C3AED"
              />
              <KpiCard
                label="ROAS"
                value={hasAdData ? totals.roas.toFixed(0) + '%' : '—'}
                sub={
                  !hasAdData ? '' :
                  totals.roas >= 500 ? '🏆 우수 (5배↑)' :
                  totals.roas >= 300 ? '👍 양호 (3배↑)' :
                  totals.roas >= 100 ? '⚖️ 보통' :
                                       '⚠️ 점검 필요'
                }
                color="#0891B2"
              />
            </>
          )}
        </div>

        {/* 차트 영역 — 동일하게 통합 로딩 */}
        {allLoading ? (
          <div style={{
            height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(90deg, #F8FAFC 0%, #F1F5F9 50%, #F8FAFC 100%)',
            backgroundSize: '200% 100%', animation: 'shimmer 1.6s ease-in-out infinite',
            borderRadius: 8, color: 'var(--t3)', fontSize: 13,
          }}>
            <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
            ⏳ 데이터 불러오는 중...
          </div>
        ) : showEmpty ? (
          <div className="empty-st" style={{ height: 280 }}>
            <div className="es-ico">📭</div>
            <div className="es-t">기간 내 매출 데이터가 없어요</div>
          </div>
        ) : (
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
              <Bar dataKey="organic" stackId="rev" name="오가닉 매출" fill={COLOR_ORGANIC} radius={[0,0,0,0]} />
              <Bar dataKey="adRev" stackId="rev" name="광고 매출" fill={COLOR_AD} radius={[3,3,0,0]}>
                <LabelList
                  dataKey="ratio"
                  position="top"
                  fontSize={9}
                  fill="#B45309"
                  formatter={(v: number) => v > 5 ? `${v}%` : ''}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {!allLoading && hasAdData === false && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#F1F5F9', borderRadius: 6, fontSize: 11, color: '#64748B' }}>
            💡 광고 데이터가 없어 모든 매출이 오가닉으로 표시됩니다. 광고 현황 탭에서 CSV 업로드 시 분리됩니다.
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

function KpiSkeleton() {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 8,
      background: '#fff', border: '1px solid #E4E7EC',
    }}>
      <div style={{
        width: '60%', height: 10, marginBottom: 8,
        background: 'linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%)',
        backgroundSize: '200% 100%', animation: 'sk 1.4s ease-in-out infinite',
        borderRadius: 3,
      }} />
      <div style={{
        width: '80%', height: 22, marginBottom: 6,
        background: 'linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%)',
        backgroundSize: '200% 100%', animation: 'sk 1.4s ease-in-out infinite',
        borderRadius: 3,
      }} />
      <div style={{
        width: '50%', height: 8,
        background: 'linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%)',
        backgroundSize: '200% 100%', animation: 'sk 1.4s ease-in-out infinite',
        borderRadius: 3,
      }} />
      <style>{`@keyframes sk { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  )
}

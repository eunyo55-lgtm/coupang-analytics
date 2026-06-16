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
  qty: number        // 총 판매수량
  rev: number        // 공급가 매출 (cost × qty, VAT 별도)
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
  units: number       // 광고 판매수량 (units_1d 또는 units_14d 합)
  adCost: number      // 광고비 (VAT 별도)
  adRevConsumer: number  // 광고 CSV의 소비자가 매출 (VAT 별도) — 참고용
}

const COLOR_ORGANIC = '#7C9CBF'
const COLOR_AD      = '#C49B6C'

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

export default function SalesAdOrganicSection({
  dailyTrend, chartFrom, chartTo,
}: Props) {
  const [adAgg, setAdAgg] = useState<Map<string, AdAggRow>>(new Map())
  const [loading, setLoading] = useState(false)
  const [hasAdData, setHasAdData] = useState<boolean | null>(null)
  const [attrWindow, setAttrWindow] = useState<'1d' | '14d'>('14d')
  const [lastUploadDate, setLastUploadDate] = useState<string | null>(null)

  // 광고 CSV raw — 일자별로 units 합계
  useEffect(() => {
    let cancelled = false
    if (!chartFrom || !chartTo) return
    async function load() {
      if (!supabase) return
      setLoading(true)
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
          if (error) {
            console.warn('[SalesAdOrganicSection] ad load:', error.message)
            break
          }
          const rows = (data || []) as any[]
          for (const r of rows) {
            const date = String(r.date)
            const cur = agg.get(date) || { date, units: 0, adCost: 0, adRevConsumer: 0 }
            const units = attrWindow === '14d' ? Number(r.units_14d || 0) : Number(r.units_1d || 0)
            const consumer = attrWindow === '14d' ? Number(r.revenue_14d || 0) : Number(r.revenue_1d || 0)
            cur.units += units
            cur.adCost += vatExcluded(Number(r.ad_cost || 0))
            cur.adRevConsumer += vatExcluded(consumer)
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
        if (agg.size > 0) {
          const dates = Array.from(agg.keys()).sort()
          setLastUploadDate(dates[dates.length - 1])
        }
      } catch (e) {
        console.warn('[SalesAdOrganicSection] load error:', e)
        if (!cancelled) { setAdAgg(new Map()); setHasAdData(false) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [chartFrom, chartTo, attrWindow])

  // 병합 — 수량 비율 기반 광고 매출 추정
  const merged = useMemo(() => {
    return dailyTrend.map(d => {
      const ad = adAgg.get(d.fullDate)
      const adUnits = ad ? ad.units : 0
      const adCost  = ad ? ad.adCost : 0
      const adRevConsumer = ad ? ad.adRevConsumer : 0
      const totalQty = d.qty
      const totalRev = d.rev   // 공급가
      // 광고 매출 (공급가) = 총 매출 × (광고 판매수량 / 총 판매수량)
      const ratio = totalQty > 0 ? (adUnits / totalQty) : 0
      const adRev = totalRev * ratio
      // adShown은 총 매출을 절대 초과하지 않음
      const adShown = Math.min(totalRev, adRev)
      const organic = Math.max(0, totalRev - adShown)
      return {
        date: d.date,
        fullDate: d.fullDate,
        qty: totalQty,
        adUnits,
        organicUnits: Math.max(0, totalQty - adUnits),
        total: totalRev,
        adRev: adShown,
        adRevConsumer,
        adCost,
        organic,
        ratio: Math.round(ratio * 1000) / 10,  // %, 소수1자리
      }
    })
  }, [dailyTrend, adAgg])

  const totals = useMemo(() => {
    const t = { total: 0, adRev: 0, adRevConsumer: 0, adCost: 0, organic: 0, adUnits: 0, qty: 0 }
    merged.forEach(r => {
      t.total += r.total
      t.adRev += r.adRev
      t.adRevConsumer += r.adRevConsumer
      t.adCost += r.adCost
      t.organic += r.organic
      t.adUnits += r.adUnits
      t.qty += r.qty
    })
    const ratio = t.qty > 0 ? (t.adUnits / t.qty) * 100 : 0  // 광고 의존도(%)는 수량 기준
    // ROAS는 업계 표준대로 판매가 기준 광고 매출 / 광고비 (쿠팡 광고센터와 동일)
    const roas = t.adCost > 0 ? (t.adRevConsumer / t.adCost) * 100 : 0
    return { ...t, ratio, roas }
  }, [merged])

  const todayMD = (() => {
    const t = new Date()
    return `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`
  })()

  const showEmpty = merged.length === 0

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">📈</div>
          <div>
            <div className="ch-title">일별 판매 추이 (판매가 매출 · 광고 vs 오가닉)</div>
            <div className="ch-sub">
              {chartFrom} ~ {chartTo} · {merged.length}일 ·
              {` ${attrWindow === '14d' ? '14일' : '1일'} 어트리뷰션 · 판매가 기준 · ${VAT_LABEL}`}
              {lastUploadDate && ` · 광고 CSV 최신: ${lastUploadDate}`}
              {loading && ' · 불러오는 중...'}
            </div>
          </div>
        </div>
        {hasAdData && (
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
                title={w === '14d' ? '쿠팡 광고센터와 동일 (14일 어트리뷰션)' : '1일 어트리뷰션'}
              >{w === '14d' ? '14일' : '1일'}</button>
            ))}
          </div>
        )}
      </div>
      <div className="cb">
        {/* KPI 카드 — 1행: 매출 분포 (판매가 기준) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
          <KpiCard
            label="총 매출 (판매가)"
            value={fmt(totals.total) + '원'}
            sub={`총 ${totals.qty.toLocaleString()}개 판매`}
            color="#0F172A"
          />
          <KpiCard
            label="광고 매출 (판매가 추정)"
            value={fmt(totals.adRev) + '원'}
            sub={hasAdData ? `광고로 ${totals.adUnits.toLocaleString()}개 판매` : '광고 데이터 없음'}
            color={COLOR_AD}
          />
          <KpiCard
            label="오가닉 매출 (판매가)"
            value={fmt(totals.organic) + '원'}
            sub={`오가닉 ${(totals.qty - totals.adUnits).toLocaleString()}개 판매`}
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

        {/* KPI 카드 — 2행: 광고 효과 (판매가 기준 ROAS) */}
        {hasAdData && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <KpiCard
              label="광고 매출 (판매가)"
              value={fmt(totals.adRevConsumer) + '원'}
              sub={`쿠팡 광고센터와 동일 · ${VAT_LABEL}`}
              color="#7C3AED"
            />
            <KpiCard
              label="광고비"
              value={fmt(totals.adCost) + '원'}
              sub={`${VAT_LABEL}`}
              color="#DC2626"
            />
            <KpiCard
              label="ROAS (판매가/광고비)"
              value={totals.roas.toFixed(0) + '%'}
              sub={
                totals.roas >= 500 ? '🏆 우수 (5배 이상)' :
                totals.roas >= 300 ? '👍 양호 (3배 이상)' :
                totals.roas >= 100 ? '⚖️ 보통 (1배 이상)' :
                                     '⚠️ 손익 점검 필요'
              }
              color="#0891B2"
            />
          </div>
        )}

        {showEmpty ? (
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
                  return `${p.fullDate} · 광고 ${p.adUnits}개 / 총 ${p.qty}개 · 의존도 ${p.ratio}%`
                }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine x={todayMD} stroke="#94A3B8" strokeDasharray="3 3" label={{ value: '오늘', fill: '#64748B', fontSize: 10, position: 'top' }} />
              <Bar dataKey="organic" stackId="rev" name="오가닉 매출 (공급가)" fill={COLOR_ORGANIC} />
              <Bar dataKey="adRev" stackId="rev" name="광고 매출 (공급가 추정)" fill={COLOR_AD}>
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
        )}

        {hasAdData === false && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#F1F5F9', borderRadius: 6, fontSize: 11, color: '#64748B' }}>
            💡 광고 데이터가 없어 모든 매출이 오가닉으로 표시됩니다. 광고 현황 탭에서 CSV 업로드 시 광고/오가닉 분리가 활성화됩니다.
          </div>
        )}

        <details style={{ marginTop: 12, fontSize: 11, color: '#64748B' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#475569' }}>
            ℹ️ 카드별 계산 기준 + 쿠팡 광고센터 숫자와의 차이
          </summary>
          <div style={{ marginTop: 8, padding: 12, background: '#F8FAFC', borderRadius: 6, lineHeight: 1.7 }}>
            <div><b>1행 — 매출 분포 (판매가 기준 · 시중가)</b></div>
            <div>• 총 매출 = 일별 판매수량 × 판매가(시중가, 어드민 데이터)</div>
            <div>• 광고 매출 (판매가 추정) = 총 매출 × 광고 의존도(수량 기준)</div>
            <div>• 오가닉 매출 = 총 매출 - 광고 매출</div>
            <div>• 광고 의존도 = 광고 판매수량 / 총 판매수량 (수량 기준이라 정확)</div>
            <div style={{ marginTop: 4, color: '#A16207' }}>※ 판매가 미입력 상품은 원가로 폴백 (마이그레이션 진행 중)</div>
            <div style={{ marginTop: 8 }}><b>2행 — 광고 효과 (판매가 기준, 쿠팡 광고센터와 동일)</b></div>
            <div>• 광고 매출 (판매가) = 광고 CSV revenue_14d (소비자가)</div>
            <div>• 광고비 = 광고 CSV ad_cost</div>
            <div>• <b>ROAS = 판매가 광고매출 / 광고비</b> — 업계 표준 · 쿠팡 광고센터 ROAS와 동일</div>
            <div style={{ marginTop: 8 }}><b>쿠팡 광고센터와 비교 시</b></div>
            <div>• 우리 1행 = 판매가 기준 ({VAT_LABEL})</div>
            <div>• 광고센터 전체 매출 = 판매가 (VAT 포함) → 우리는 ÷1.1 정도 작음</div>
            <div>• <b>비율(광고 의존도)은 양쪽이 같아야 정상</b></div>
            <div style={{ marginTop: 8 }}><b>왜 옵션ID로 직접 매칭을 못 하나?</b></div>
            <div>• 광고 CSV 옵션ID(긴 숫자) ↔ products.barcode(SKU) 매핑 데이터 없음 — 정확 매칭 0건 확인</div>
            <div>• 그래서 수량 비율 기반으로 추정 (의존도 % 는 정확)</div>
            {hasAdData && (
              <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 4 }}>
                <div>광고 판매수량: <b>{totals.adUnits.toLocaleString()}개</b> / 총 <b>{totals.qty.toLocaleString()}개</b></div>
                <div>광고 의존도 (수량): <b>{totals.ratio.toFixed(1)}%</b> — 쿠팡 광고센터의 광고매출/전체매출 비율과 비교</div>
                <div>ROAS: <b>{totals.roas.toFixed(0)}%</b> (판매가 기준)</div>
              </div>
            )}
            <div style={{ marginTop: 8, color: '#475569' }}>
              <b>📌 향후 정확도 향상:</b> 옵션ID ↔ 바코드 매핑 테이블 채우면 수량/매출 모두 옵션별 정확 분리 가능.
            </div>
          </div>
        </details>
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

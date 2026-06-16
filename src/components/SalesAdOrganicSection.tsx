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
  rev: number        // 공급가 매출 (cost × qty, VAT 별도)
}

type Props = {
  dailyTrend: DailyTrend[]
  chartFrom: string
  chartTo: string
  mode: 'qty' | 'rev'
  salesDataLoading: boolean
}

// 광고 CSV raw 행 (필요한 컬럼만)
type AdRawRow = {
  date: string
  conv_option_id: string | null
  units_1d: number
  units_14d: number
  revenue_1d: number    // 소비자가 매출 (참고용)
  revenue_14d: number   // 소비자가 매출 (참고용)
  ad_cost: number
}

// 톤 다운된 팔레트
const COLOR_ORGANIC = '#7C9CBF'
const COLOR_AD      = '#C49B6C'

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

export default function SalesAdOrganicSection({
  dailyTrend, chartFrom, chartTo,
}: Props) {
  const [adRows, setAdRows] = useState<AdRawRow[]>([])
  const [costByBarcode, setCostByBarcode] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)
  const [hasAdData, setHasAdData] = useState<boolean | null>(null)
  const [attrWindow, setAttrWindow] = useState<'1d' | '14d'>('14d')
  const [lastUploadDate, setLastUploadDate] = useState<string | null>(null)
  const [diagOpen, setDiagOpen] = useState(false)

  // 광고 raw 데이터 + 옵션ID별 공급가 로드
  useEffect(() => {
    let cancelled = false
    if (!chartFrom || !chartTo) return
    async function load() {
      if (!supabase) return
      setLoading(true)
      try {
        // 1) 광고 CSV raw 행 (option-level units 포함)
        const PAGE = 1000
        const all: AdRawRow[] = []
        let from = 0
        while (true) {
          const { data, error } = await supabase
            .from('coupang_ad_daily')
            .select('date, conv_option_id, units_1d, units_14d, revenue_1d, revenue_14d, ad_cost')
            .gte('date', chartFrom)
            .lte('date', chartTo)
            .order('date', { ascending: true })
            .range(from, from + PAGE - 1)
          if (cancelled) return
          if (error) {
            console.warn('[SalesAdOrganicSection] ad load:', error.message)
            break
          }
          const rows = (data || []) as AdRawRow[]
          all.push(...rows)
          if (rows.length < PAGE) break
          from += PAGE
          if (all.length > 50000) break
        }
        if (cancelled) return
        setAdRows(all)
        setHasAdData(all.length > 0)

        // 마지막 업로드 일자 (가장 최근 date)
        if (all.length > 0) {
          const maxDate = all.reduce((m, r) => r.date > m ? r.date : m, all[0].date)
          setLastUploadDate(maxDate)
        } else {
          setLastUploadDate(null)
        }

        // 2) 광고 행에 등장한 unique 옵션ID → products.cost 조회
        const optionIds = Array.from(new Set(
          all.map(r => String(r.conv_option_id || '')).filter(Boolean)
        ))
        const costMap = new Map<string, number>()
        if (optionIds.length > 0) {
          const CHUNK = 200
          for (let i = 0; i < optionIds.length; i += CHUNK) {
            if (cancelled) return
            const chunk = optionIds.slice(i, i + CHUNK)
            const { data } = await supabase
              .from('products')
              .select('barcode, cost')
              .in('barcode', chunk)
            ;(data || []).forEach((p: any) => {
              const bc = String(p.barcode || '')
              if (bc) costMap.set(bc, vatExcluded(Number(p.cost || 0)))
            })
          }
        }
        if (!cancelled) setCostByBarcode(costMap)
      } catch (e) {
        console.warn('[SalesAdOrganicSection] load error:', e)
        if (!cancelled) { setAdRows([]); setHasAdData(false); setCostByBarcode(new Map()) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [chartFrom, chartTo])

  // 날짜별 광고 매출(공급가) + 광고비 집계
  const adByDate = useMemo(() => {
    const m = new Map<string, { adRevSupplier: number; adCost: number; adRevConsumer: number; units: number }>()
    for (const r of adRows) {
      const date = r.date
      const units = attrWindow === '14d' ? Number(r.units_14d || 0) : Number(r.units_1d || 0)
      const consumerRev = attrWindow === '14d' ? Number(r.revenue_14d || 0) : Number(r.revenue_1d || 0)
      const cost = costByBarcode.get(String(r.conv_option_id || '')) || 0
      const supplierRev = units * cost
      const cur = m.get(date) || { adRevSupplier: 0, adCost: 0, adRevConsumer: 0, units: 0 }
      cur.adRevSupplier += supplierRev
      cur.adCost += vatExcluded(Number(r.ad_cost || 0))
      cur.adRevConsumer += vatExcluded(consumerRev)
      cur.units += units
      m.set(date, cur)
    }
    return m
  }, [adRows, costByBarcode, attrWindow])

  // dailyTrend + 광고 데이터 병합
  const merged = useMemo(() => {
    return dailyTrend.map(d => {
      const ad = adByDate.get(d.fullDate)
      const adRev   = ad ? ad.adRevSupplier : 0
      const adCost  = ad ? ad.adCost : 0
      const adUnits = ad ? ad.units : 0
      const total = d.rev  // 공급가 기준 총 매출
      const organic = Math.max(0, total - adRev)
      const adShown = total >= adRev ? adRev : total
      const ratio = total > 0 ? (adRev / total) * 100 : 0
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
  }, [dailyTrend, adByDate])

  // 기간 합계
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
    return { ...t, ratio, roas }
  }, [merged])

  // 소비자가 기준 광고 매출 합계 (참고 표시용)
  const adRevConsumerTotal = useMemo(() => {
    let sum = 0
    for (const [, v] of adByDate) sum += v.adRevConsumer
    return sum
  }, [adByDate])

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
            <div className="ch-title">일별 판매 추이 (공급가 매출 · 광고 vs 오가닉)</div>
            <div className="ch-sub">
              {chartFrom} ~ {chartTo} · {merged.length}일 ·
              {` ${attrWindow === '14d' ? '14일' : '1일'} 어트리뷰션 · 공급가 기준 · ${VAT_LABEL}`}
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
        {/* KPI 카드 — 항상 표시 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          <KpiCard
            label="총 매출 (공급가)"
            value={fmt(totals.total) + '원'}
            sub={`총 ${totals.qty.toLocaleString()}개`}
            color="#0F172A"
          />
          <KpiCard
            label="광고 매출 (공급가)"
            value={fmt(totals.adRev) + '원'}
            sub={hasAdData
              ? `광고비 ${fmt(totals.adCost)}원 · ROAS ${totals.roas.toFixed(0)}%`
              : '광고 데이터 없음'}
            color={COLOR_AD}
          />
          <KpiCard
            label="오가닉 매출 (공급가)"
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
                  return `${p.fullDate} · 광고 의존도 ${p.ratio}% · 광고 ${p.adUnits}개`
                }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine x={todayMD} stroke="#94A3B8" strokeDasharray="3 3" label={{ value: '오늘', fill: '#64748B', fontSize: 10, position: 'top' }} />
              <Bar dataKey="organic" stackId="rev" name="오가닉 매출 (공급가)" fill={COLOR_ORGANIC} />
              <Bar dataKey="adRev" stackId="rev" name="광고 매출 (공급가)" fill={COLOR_AD}>
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

        {/* 정의 + 진단 */}
        <details
          open={diagOpen}
          onToggle={(e) => setDiagOpen((e.target as HTMLDetailsElement).open)}
          style={{ marginTop: 12, fontSize: 11, color: '#64748B' }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#475569' }}>
            ℹ️ 계산 방식과 쿠팡 광고센터 숫자와의 차이 (클릭)
          </summary>
          <div style={{ marginTop: 8, padding: 12, background: '#F8FAFC', borderRadius: 6, lineHeight: 1.7 }}>
            <div><b>로켓배송 공급자 기준으로 통일된 계산:</b></div>
            <div>• <b>총 매출 (공급가)</b> = 일별 판매수량 × 공급가 (서플라이 허브 실수령액 기준)</div>
            <div>• <b>광고 매출 (공급가)</b> = 광고 CSV 옵션별 판매수량 × 같은 옵션의 공급가</div>
            <div>• <b>오가닉 매출</b> = 총 매출 − 광고 매출</div>
            <div>• 셋 다 동일한 공급가 베이스로 비교 (사과 vs 사과)</div>
            <div style={{ marginTop: 8 }}><b>쿠팡 광고센터 숫자와 다른 이유:</b></div>
            <div>• 쿠팡 광고센터의 "전체 매출", "광고 전환 매출"은 <b>소비자가 (VAT 포함, 마진 포함)</b> 기준</div>
            <div>• 우리는 <b>공급가 (서플라이 허브 기준, {VAT_LABEL})</b>이라 절대 금액이 작음</div>
            <div>• <b>비율</b>은 두 기준 모두 비슷해야 함 (광고 의존도 % 정도가 진짜 비교 지표)</div>
            {hasAdData && (
              <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 4 }}>
                참고 — 광고 CSV의 소비자가 기준 광고 매출 합계: <b>{fmt(adRevConsumerTotal)}원 ({VAT_LABEL})</b>
                <br />→ 공급가 환산: <b>{fmt(totals.adRev)}원</b> · 비율 {totals.adRev > 0 && adRevConsumerTotal > 0
                  ? `${(totals.adRev / adRevConsumerTotal * 100).toFixed(1)}% (공급가/소비자가)`
                  : 'N/A'}
              </div>
            )}
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

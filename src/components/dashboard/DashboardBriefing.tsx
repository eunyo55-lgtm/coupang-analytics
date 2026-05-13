'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  latestDate: string
  yestQty?: number
  yestRev?: number
  yoyPct: number | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
const fmtMoney = (n: number) => {
  if (n >= 100_000_000) return (Math.round(n / 10_000_000) / 10).toLocaleString('ko-KR') + '억'
  if (n >= 10_000_000) return (Math.round(n / 10_000) / 100).toLocaleString('ko-KR') + '천만'
  if (n >= 10_000) return (Math.round(n / 1000) / 10).toLocaleString('ko-KR') + '만'
  return Math.round(n).toLocaleString('ko-KR')
}

function dayOfWeekKor(yyyy_mm_dd: string): string {
  if (!yyyy_mm_dd) return ''
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()]
}

/**
 * 한 줄짜리 오늘의 브리핑 — 어제 매출/광고 ROAS/관리 키워드 1페이지 비율.
 * 5초 안에 "오늘 어떤가" 파악용.
 */
export default function DashboardBriefing({ latestDate, yestRev, yoyPct }: Props) {
  const [adRoas, setAdRoas] = useState<number | null>(null)
  const [adCost, setAdCost] = useState<number | null>(null)
  const [adDate, setAdDate] = useState<string>('')
  const [p1Stats, setP1Stats] = useState<{ total: number; onP1: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      try {
        // 가장 최신 광고 일자
        const { data: ad } = await supabase
          .from('coupang_ad_daily_summary')
          .select('date, ad_cost, revenue_14d')
          .order('date', { ascending: false })
          .limit(1)
        if (!cancelled && ad && ad.length > 0) {
          const r = ad[0]
          const cost = Number(r.ad_cost || 0)
          const rev = Number(r.revenue_14d || 0)
          setAdCost(cost)
          setAdRoas(cost > 0 ? rev / cost : 0)
          setAdDate(r.date)
        }
        // 1페이지 점유 키워드 (가장 최근 스냅샷 기준, rank<=40)
        const { data: kws } = await supabase.from('keywords').select('id')
        const total = kws?.length ?? 0
        if (total > 0) {
          // 가장 최근 date 기준 1페이지 인 keyword_id 수
          const { data: ranks } = await supabase
            .from('keyword_rankings')
            .select('keyword_id, date, rank_position')
            .order('date', { ascending: false })
            .limit(2000)
          if (!cancelled && ranks && ranks.length > 0) {
            const latestRankDate = ranks[0].date
            const latest = ranks.filter((r: any) => r.date === latestRankDate)
            const onP1 = latest.filter((r: any) => r.rank_position && r.rank_position <= 40).length
            setP1Stats({ total: latest.length, onP1 })
          } else if (!cancelled) {
            setP1Stats({ total, onP1: 0 })
          }
        }
      } catch (e) {
        console.warn('[DashboardBriefing]', e)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const dow = dayOfWeekKor(latestDate)

  return (
    <div style={{
      background: 'linear-gradient(135deg, #fef3c7 0%, #fef9e7 100%)',
      border: '1px solid #fcd34d',
      borderRadius: 10, padding: '14px 18px', marginBottom: 12,
    }}>
      <div style={{ fontSize: 12, color: '#92400e', fontWeight: 700, marginBottom: 4 }}>
        🌅 오늘의 브리핑 · {latestDate}{dow ? ` (${dow})` : ''}
      </div>
      <div style={{ fontSize: 14, color: '#78350f', lineHeight: 1.6, fontWeight: 500 }}>
        {/* 어제 매출 */}
        어제 매출 <b>{yestRev != null ? fmtMoney(yestRev) + '원' : '—'}</b>
        {yoyPct !== null && (
          <span style={{ color: yoyPct >= 0 ? '#15803d' : '#dc2626', marginLeft: 6, fontWeight: 700 }}>
            {yoyPct >= 0 ? '▲' : '▼'}{Math.abs(yoyPct)}% (전년)
          </span>
        )}
        {' · '}
        {/* 광고 */}
        광고 ROAS <b>{adRoas != null ? (adRoas * 100).toFixed(0) + '%' : '—'}</b>
        {adCost != null && <span style={{ color: '#a16207', marginLeft: 4 }}>(어제 광고비 {fmt(adCost)}원)</span>}
        {' · '}
        {/* 키워드 1페이지 */}
        1페이지 {p1Stats ? (
          <><b>{p1Stats.onP1}/{p1Stats.total}</b> 키워드
            <span style={{ color: '#a16207', marginLeft: 4 }}>
              ({p1Stats.total > 0 ? Math.round(p1Stats.onP1 / p1Stats.total * 100) : 0}%)
            </span>
          </>
        ) : '—'}
      </div>
      {adDate && adDate !== latestDate && (
        <div style={{ fontSize: 10, color: '#a16207', marginTop: 4 }}>
          ⓘ 광고 최신: {adDate} · 판매 최신: {latestDate}
        </div>
      )}
    </div>
  )
}

'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  dateFrom: string  // 'YYYY-MM-DD'
  dateTo: string
}

type Signal = {
  level: 'critical' | 'warning' | 'info'
  icon: string
  title: string
  detail: string
}

const LEVEL_COLOR: Record<Signal['level'], { bg: string; border: string; fg: string }> = {
  critical: { bg: '#fef2f2', border: '#fca5a5', fg: '#991b1b' },
  warning:  { bg: '#fef3c7', border: '#fcd34d', fg: '#92400e' },
  info:     { bg: '#dbeafe', border: '#93c5fd', fg: '#1e40af' },
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

/**
 * 광고 데이터로 자동 검출하는 5가지 신호.
 *  1) ROAS 미달 캠페인 (sum(revenue_14d)/sum(ad_cost) < 5)
 *  2) 광고비 급증 (가장 최근 일자가 이전 7일 평균의 1.8배 초과)
 *  3) CTR 급락 (가장 최근 일자가 이전 7일 평균의 60% 미만)
 *  4) 신규 키워드 기회 (광고 노출 키워드 중 keywords 테이블에 없는 것)
 *  5) 광고 의존도 (광고매출 / 전체매출이 너무 높은 경우 — 옵션)
 */
export default function AdSignalCards({ dateFrom, dateTo }: Props) {
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function detect() {
      if (!supabase) return
      setLoading(true)
      const list: Signal[] = []

      try {
        // ── 신호 1: ROAS 미달 캠페인 ───────────────────────────────
        const { data: campaigns } = await supabase
          .rpc('get_ad_breakdown', { p_date_from: dateFrom, p_date_to: dateTo, p_group_by: 'campaign' })
        if (campaigns && Array.isArray(campaigns)) {
          const under = (campaigns as Array<{ name: string; ad_cost: number; revenue_14d: number }>)
            .filter(c => Number(c.ad_cost) > 10000) // 의미 있는 광고비만
            .map(c => ({
              name: c.name,
              cost: Number(c.ad_cost),
              rev: Number(c.revenue_14d),
              roas: Number(c.ad_cost) > 0 ? Number(c.revenue_14d) / Number(c.ad_cost) : 0,
            }))
            .filter(c => c.roas < 5) // ROAS < 500%
            .sort((a, b) => a.roas - b.roas)
          if (under.length > 0) {
            list.push({
              level: 'critical',
              icon: '🔴',
              title: `ROAS 500% 미만 캠페인 ${under.length}개`,
              detail: under.slice(0, 3).map(c =>
                `${c.name.slice(0, 18)} · ${(c.roas * 100).toFixed(0)}% (광고비 ${fmt(c.cost)}원)`
              ).join(' · '),
            })
          }
        }

        // ── 신호 2 & 3: 광고비 급증 / CTR 급락 (일별 비교) ─────────
        const { data: daily } = await supabase
          .from('coupang_ad_daily_summary')
          .select('date, ad_cost, impressions, clicks, ctr')
          .lte('date', dateTo)
          .order('date', { ascending: false })
          .limit(8)
        if (daily && daily.length >= 4) {
          const latest = daily[0]
          const prev7 = daily.slice(1)
          // 광고비 급증
          const avgCost = prev7.reduce((s, r) => s + Number(r.ad_cost || 0), 0) / prev7.length
          const latestCost = Number(latest.ad_cost || 0)
          if (avgCost > 0 && latestCost > avgCost * 1.8) {
            list.push({
              level: 'warning',
              icon: '🟡',
              title: '광고비 급증',
              detail: `${latest.date}: ${fmt(latestCost)}원 (이전 7일 평균 ${fmt(avgCost)}원 대비 ${Math.round(latestCost / avgCost * 100)}%)`,
            })
          }
          // CTR 급락
          const avgCtr = prev7.reduce((s, r) => s + Number(r.ctr || 0), 0) / prev7.length
          const latestCtr = Number(latest.ctr || 0)
          if (avgCtr > 0 && latestCtr < avgCtr * 0.6) {
            list.push({
              level: 'warning',
              icon: '🟡',
              title: 'CTR 급락',
              detail: `${latest.date}: ${latestCtr.toFixed(2)}% (이전 7일 평균 ${avgCtr.toFixed(2)}% 대비 ${Math.round(latestCtr / avgCtr * 100)}%) — 광고 소재 점검 권장`,
            })
          }
        }

        // ── 신호 4: 신규 키워드 기회 (광고 노출 키워드 중 미등록) ─
        const { data: adKws } = await supabase
          .rpc('get_ad_breakdown', { p_date_from: dateFrom, p_date_to: dateTo, p_group_by: 'keyword' })
        const { data: tracked } = await supabase.from('keywords').select('keyword')
        if (adKws && tracked) {
          const trackedSet = new Set((tracked as Array<{ keyword: string }>).map(k => k.keyword))
          const newOnes = (adKws as Array<{ name: string; revenue_14d: number; ad_cost: number }>)
            .filter(k => k.name !== '(미지정)' && !trackedSet.has(k.name))
            .filter(k => Number(k.revenue_14d) > 50000) // 의미 있는 광고매출
            .sort((a, b) => Number(b.revenue_14d) - Number(a.revenue_14d))
          if (newOnes.length > 0) {
            list.push({
              level: 'info',
              icon: '🟢',
              title: `미등록 광고 키워드 ${newOnes.length}개 발견`,
              detail: '상위 3개: ' + newOnes.slice(0, 3).map(k =>
                `${k.name} (광고매출 ${fmt(Number(k.revenue_14d))}원)`
              ).join(', '),
            })
          }
        }
      } catch (e) {
        console.warn('[AdSignalCards] detect error', e)
      }

      if (!cancelled) {
        setSignals(list)
        setLoading(false)
      }
    }
    detect()
    return () => { cancelled = true }
  }, [dateFrom, dateTo])

  const grouped = useMemo(() => {
    const cnt: Record<Signal['level'], number> = { critical: 0, warning: 0, info: 0 }
    signals.forEach(s => cnt[s.level]++)
    return cnt
  }, [signals])

  if (loading) {
    return (
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 12, color: '#94a3b8' }}>
        🔍 광고 신호 분석 중...
      </div>
    )
  }
  if (signals.length === 0) {
    return (
      <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13, color: '#065f46', fontWeight: 600 }}>
        ✅ 광고 운영 정상 — 위험 신호 없음
      </div>
    )
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, fontSize: 12, color: '#475569', fontWeight: 600 }}>
        <span>🚨 광고 신호</span>
        <span style={{ color: '#94a3b8', fontWeight: 400 }}>
          {grouped.critical}개 위험 · {grouped.warning}개 주의 · {grouped.info}개 기회
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
        {signals.map((s, i) => {
          const c = LEVEL_COLOR[s.level]
          return (
            <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.fg, marginBottom: 3 }}>
                {s.icon} {s.title}
              </div>
              <div style={{ fontSize: 11, color: c.fg, lineHeight: 1.5 }}>{s.detail}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

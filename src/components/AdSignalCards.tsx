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
  action?: string   // 💡 구체적인 다음 행동
  link?: { label: string; href: string } // 원클릭 액션
}

const LEVEL_COLOR: Record<Signal['level'], { bg: string; border: string; fg: string; actionBg: string }> = {
  critical: { bg: '#fef2f2', border: '#fca5a5', fg: '#991b1b', actionBg: '#fff' },
  warning:  { bg: '#fef3c7', border: '#fcd34d', fg: '#92400e', actionBg: '#fff' },
  info:     { bg: '#dbeafe', border: '#93c5fd', fg: '#1e40af', actionBg: '#fff' },
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

/**
 * 광고 데이터로 자동 검출하는 신호 + 구체적 액션 가이드.
 *  1) ROAS 미달 캠페인
 *  2) 광고비 급증
 *  3) CTR 급락
 *  4) 신규 키워드 기회 (광고로 매출은 나지만 우리가 추적 안 하는 키워드)
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
            .filter(c => Number(c.ad_cost) > 10000)
            .map(c => ({
              name: c.name,
              cost: Number(c.ad_cost),
              rev: Number(c.revenue_14d),
              roas: Number(c.ad_cost) > 0 ? Number(c.revenue_14d) / Number(c.ad_cost) : 0,
            }))
            .filter(c => c.roas < 5)
            .sort((a, b) => a.roas - b.roas)
          const wastedCost = under.reduce((s, c) => s + c.cost, 0)
          if (under.length > 0) {
            list.push({
              level: 'critical',
              icon: '🔴',
              title: `ROAS 500% 미만 캠페인 ${under.length}개 (광고비 ${fmt(wastedCost)}원 사용)`,
              detail: under.slice(0, 3).map(c =>
                `${c.name.slice(0, 18)} · ${(c.roas * 100).toFixed(0)}% (광고비 ${fmt(c.cost)}원)`
              ).join(' · '),
              action:
                '📌 쿠팡 광고 콘솔에서 ① 입찰가 -20% 인하 또는 ② 일시 중지. ' +
                '캠페인 안의 어떤 키워드가 ROAS 낮은지 (아래 "차원별 성과 → 키워드별" 탭) 확인 후 ' +
                '문제 키워드만 정밀하게 끄는 것이 최선. ROAS 200% 미만은 즉시 중단 권장.',
            })
          }
        }

        // ── 신호 2 & 3: 광고비 급증 / CTR 급락 ─────────
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
              title: '광고비 급증 감지',
              detail: `${latest.date}: ${fmt(latestCost)}원 (전 7일 평균 ${fmt(avgCost)}원 대비 ${Math.round(latestCost / avgCost * 100)}%)`,
              action:
                '📌 ① 의도된 증액인지 확인 (신규 캠페인/이벤트?) ② 아니라면 일 예산 cap 또는 입찰 상한선 설정. ' +
                '③ 같은 날 광고매출이 비례해서 늘었는지 위 KPI에서 확인 — ROAS 떨어졌으면 즉시 입찰 조정.',
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
              detail: `${latest.date}: ${latestCtr.toFixed(2)}% (전 7일 평균 ${avgCtr.toFixed(2)}% 대비 ${Math.round(latestCtr / avgCtr * 100)}%)`,
              action:
                '📌 ① 광고 소재 점검: 썸네일·제목·가격이 경쟁사 대비 매력 떨어지는지. ' +
                '② 검색량은 늘었는데 클릭 안 됨 → 노출 키워드 범위가 너무 넓어졌을 가능성 (정확매칭으로 좁히기). ' +
                '③ 경쟁사 신규 진입 / 시즌 변화 — 가격이나 혜택 재조정 검토.',
            })
          }
        }

        // ── 신호 4: 신규 키워드 기회 ─
        const { data: adKws } = await supabase
          .rpc('get_ad_breakdown', { p_date_from: dateFrom, p_date_to: dateTo, p_group_by: 'keyword' })
        const { data: tracked } = await supabase.from('keywords').select('keyword')
        if (adKws && tracked) {
          const trackedSet = new Set((tracked as Array<{ keyword: string }>).map(k => k.keyword))
          const newOnes = (adKws as Array<{ name: string; revenue_14d: number; ad_cost: number }>)
            .filter(k => k.name !== '(미지정)' && !trackedSet.has(k.name))
            .filter(k => Number(k.revenue_14d) > 50000)
            .sort((a, b) => Number(b.revenue_14d) - Number(a.revenue_14d))
          const totalNewRev = newOnes.reduce((s, k) => s + Number(k.revenue_14d || 0), 0)
          if (newOnes.length > 0) {
            list.push({
              level: 'info',
              icon: '🟢',
              title: `광고로 매출 발생 중인 미등록 키워드 ${newOnes.length}개 (총 ${fmt(totalNewRev)}원)`,
              detail: '상위 3: ' + newOnes.slice(0, 3).map(k =>
                `"${k.name}" (광고매출 ${fmt(Number(k.revenue_14d))}원)`
              ).join(', '),
              action:
                '📌 왜 중요한가: 광고로는 이 키워드에서 돈을 벌고 있지만 우리는 자연검색 순위를 모니터링하지 않고 있음. ' +
                '자연검색에서도 잘 노출되면 같은 매출을 광고비 0원으로 가져올 수 있음. ' +
                '✅ 다음 행동: ① /agent 페이지에서 "[키워드] 등록, 상품 ID 1234567890" 입력 → 매일 자동 순위 추적 시작 ' +
                '② 자연검색 순위가 낮으면 (10위 밖) 상품명·태그·이미지 최적화 우선순위 ↑ ' +
                '③ 순위가 충분히 오르면 해당 키워드 광고비 줄여도 매출 유지 가능.',
              link: { label: '🤖 AI에게 등록 위임', href: '/agent' },
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
        <span>🚨 광고 신호 & 액션 가이드</span>
        <span style={{ color: '#94a3b8', fontWeight: 400 }}>
          {grouped.critical}개 위험 · {grouped.warning}개 주의 · {grouped.info}개 기회
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 8 }}>
        {signals.map((s, i) => {
          const c = LEVEL_COLOR[s.level]
          return (
            <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.fg, marginBottom: 4 }}>
                {s.icon} {s.title}
              </div>
              <div style={{ fontSize: 11, color: c.fg, lineHeight: 1.5, marginBottom: 8 }}>{s.detail}</div>
              {s.action && (
                <div style={{
                  background: c.actionBg, borderLeft: `3px solid ${c.border}`, borderRadius: 4,
                  padding: '8px 10px', fontSize: 11, color: '#334155', lineHeight: 1.55,
                }}>
                  <div style={{ fontWeight: 700, color: c.fg, marginBottom: 4 }}>💡 어떻게 대응할까?</div>
                  {s.action}
                  {s.link && (
                    <a href={s.link.href} style={{
                      display: 'inline-block', marginTop: 6, padding: '4px 10px',
                      background: c.fg, color: 'white', borderRadius: 4, fontSize: 11,
                      fontWeight: 600, textDecoration: 'none',
                    }}>{s.link.label}</a>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

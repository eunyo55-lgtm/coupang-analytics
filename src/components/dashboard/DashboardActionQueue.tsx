'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toYMD } from '@/lib/dateUtils'

type Priority = 'critical' | 'warning' | 'info'

type ActionItem = {
  priority: Priority
  source: string         // '재고' | '광고' | '키워드' 등
  icon: string
  title: string
  detail: string
  link?: { label: string; href: string }
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, warning: 1, info: 2 }
const PRIORITY_COLOR: Record<Priority, { bg: string; border: string; fg: string; tag: string }> = {
  critical: { bg: '#fef2f2', border: '#fca5a5', fg: '#991b1b', tag: '🔴 위험' },
  warning:  { bg: '#fef3c7', border: '#fcd34d', fg: '#92400e', tag: '🟡 주의' },
  info:     { bg: '#dbeafe', border: '#93c5fd', fg: '#1e40af', tag: '🟢 기회' },
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

function shiftDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
}

/**
 * 모든 탭에서 시급한 액션을 모아 우선순위로 정렬.
 * 출처: 재고 / 광고 (ROAS·미등록 키워드) / 키워드 (검색량 급등) / 랭킹 (1페이지 이탈)
 */
export default function DashboardActionQueue() {
  const [items, setItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      setLoading(true)
      const list: ActionItem[] = []

      const today = toYMD(new Date())
      const sevenDaysAgo = shiftDays(today, -7)
      const fourteenDaysAgo = shiftDays(today, -14)

      try {
        // ── 1) 재고 부족: coupang_stock = 0이면서 최근 일평균 판매 > 0 ───
        const invRes = await supabase.rpc('get_inventory_summary', {
          p_from: sevenDaysAgo, p_to: today,
        }).then(r => r, () => ({ data: null }))
        if (invRes && Array.isArray(invRes.data)) {
          type Inv = { name: string; coupang_stock: number; daily_sales: number; days_left: number | null }
          const lows = (invRes.data as Inv[])
            .filter(r => r.coupang_stock === 0 && (r.daily_sales || 0) > 0)
            .sort((a, b) => (b.daily_sales || 0) - (a.daily_sales || 0))
          if (lows.length > 0) {
            const lostDaily = lows.reduce((s, r) => s + (r.daily_sales || 0), 0)
            list.push({
              priority: 'critical',
              source: '재고',
              icon: '📦',
              title: `쿠팡 재고 0 + 판매 중 상품 ${lows.length}개`,
              detail: `일평균 ${fmt(lostDaily)}개 판매 손실 추정 · ` +
                lows.slice(0, 3).map(r => `${r.name.slice(0, 14)}(${fmt(r.daily_sales)}개/일)`).join(', ') +
                (lows.length > 3 ? ` 외 ${lows.length - 3}건` : ''),
              link: { label: '재고 탭에서 확인', href: '/inventory' },
            })
          }
          // ── 임박: 3일 내 소진 (days_left <= 3, coupang_stock > 0)
          const imminent = (invRes.data as Inv[])
            .filter(r => r.coupang_stock > 0 && r.days_left != null && r.days_left <= 3)
            .sort((a, b) => (a.days_left || 0) - (b.days_left || 0))
          if (imminent.length > 0) {
            list.push({
              priority: 'warning',
              source: '재고',
              icon: '⏳',
              title: `3일 내 재고 소진 임박 ${imminent.length}개`,
              detail: imminent.slice(0, 3).map(r => `${r.name.slice(0, 14)}(${r.days_left}일)`).join(', ') +
                (imminent.length > 3 ? ` 외 ${imminent.length - 3}건` : ''),
              link: { label: '공급 탭으로', href: '/supply' },
            })
          }
        }

        // ── 2) 광고 ROAS 미달 캠페인 (최근 7일) ───
        const adFromY = sevenDaysAgo, adToY = today
        const camp = await supabase.rpc('get_ad_breakdown', {
          p_date_from: adFromY, p_date_to: adToY, p_group_by: 'campaign',
        }).then(r => r, () => ({ data: null }))
        if (camp && Array.isArray(camp.data)) {
          type C = { name: string; ad_cost: number; revenue_14d: number }
          const under = (camp.data as C[])
            .map(c => ({
              name: c.name,
              cost: Number(c.ad_cost || 0),
              rev: Number(c.revenue_14d || 0),
              roas: Number(c.ad_cost || 0) > 0 ? Number(c.revenue_14d || 0) / Number(c.ad_cost || 0) : 0,
            }))
            .filter(c => c.cost >= 10000 && c.roas < 5)
            .sort((a, b) => a.roas - b.roas)
          const wasted = under.reduce((s, c) => s + c.cost, 0)
          if (under.length > 0) {
            list.push({
              priority: 'warning',
              source: '광고',
              icon: '📉',
              title: `ROAS 500% 미만 캠페인 ${under.length}개 (광고비 ${fmt(wasted)}원)`,
              detail: under.slice(0, 3).map(c =>
                `${c.name.slice(0, 16)} (${(c.roas * 100).toFixed(0)}%)`
              ).join(' · '),
              link: { label: '광고 탭에서 분석', href: '/ad' },
            })
          }
        }

        // ── 3) 미등록 광고 키워드 ───
        const kwAd = await supabase.rpc('get_ad_breakdown', {
          p_date_from: adFromY, p_date_to: adToY, p_group_by: 'keyword',
        }).then(r => r, () => ({ data: null }))
        const trackedRes = await supabase.from('keywords').select('keyword')
        if (kwAd && Array.isArray(kwAd.data) && trackedRes.data) {
          type K = { name: string; revenue_14d: number }
          const trackedSet = new Set((trackedRes.data as Array<{ keyword: string }>).map(k => k.keyword))
          const newOnes = (kwAd.data as K[])
            .filter(k => k.name && k.name !== '(미지정)' && !trackedSet.has(k.name) && Number(k.revenue_14d || 0) > 50000)
            .sort((a, b) => Number(b.revenue_14d) - Number(a.revenue_14d))
          if (newOnes.length > 0) {
            const totalRev = newOnes.reduce((s, k) => s + Number(k.revenue_14d || 0), 0)
            list.push({
              priority: 'info',
              source: '키워드',
              icon: '🔍',
              title: `광고 매출 발생 중인 미등록 키워드 ${newOnes.length}개 (${fmt(totalRev)}원)`,
              detail: '상위: ' + newOnes.slice(0, 3).map(k => `"${k.name}"`).join(', '),
              link: { label: 'AI에 등록 위임', href: '/agent' },
            })
          }
        }

        // ── 4) 검색량 급등 (이미 추적 중인 키워드) ───
        const sinceVol = shiftDays(today, -14)
        const { data: vols } = await supabase
          .from('keyword_search_volumes')
          .select('keyword, target_date, total_volume')
          .gte('target_date', sinceVol)
        if (vols) {
          type V = { keyword: string; target_date: string; total_volume: number }
          const cutoff = shiftDays(today, -7)
          const acc: Record<string, { recent: number[]; prev: number[] }> = {}
          for (const r of (vols as V[])) {
            if (!acc[r.keyword]) acc[r.keyword] = { recent: [], prev: [] }
            const v = Number(r.total_volume || 0)
            if (r.target_date >= cutoff) acc[r.keyword].recent.push(v)
            else acc[r.keyword].prev.push(v)
          }
          const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
          const surges = Object.entries(acc)
            .map(([k, v]) => {
              const r = avg(v.recent), p = avg(v.prev)
              const pct = p > 0 ? (r - p) / p * 100 : 0
              return { keyword: k, recent: r, change_pct: pct }
            })
            .filter(s => s.change_pct >= 30 && s.recent >= 1000)
            .sort((a, b) => b.change_pct - a.change_pct)
          if (surges.length > 0) {
            list.push({
              priority: 'info',
              source: '키워드',
              icon: '📈',
              title: `검색량 급등 키워드 ${surges.length}개 (전주 대비 +30% 이상)`,
              detail: surges.slice(0, 3).map(s =>
                `"${s.keyword}" ▲${s.change_pct.toFixed(0)}% (${fmt(s.recent)}/일)`
              ).join(', '),
              link: { label: '랭킹 탭에서 확인', href: '/ranking' },
            })
          }
        }

        // ── 5) 1페이지 이탈 키워드 (랭킹 데이터에서 어제 vs 그제) ───
        try {
          const { data: ranks } = await supabase
            .from('keyword_rankings')
            .select('keyword_id, date, rank_position')
            .order('date', { ascending: false })
            .limit(5000)
          if (ranks && ranks.length > 0) {
            type R = { keyword_id: number; date: string; rank_position: number | null }
            const sorted = (ranks as R[]).sort((a, b) => b.date.localeCompare(a.date))
            const latestDate = sorted[0].date
            const prevDate = sorted.find(r => r.date < latestDate)?.date
            if (prevDate) {
              const latestMap = new Map<number, number | null>()
              const prevMap = new Map<number, number | null>()
              sorted.forEach(r => {
                if (r.date === latestDate && !latestMap.has(r.keyword_id)) latestMap.set(r.keyword_id, r.rank_position)
                if (r.date === prevDate && !prevMap.has(r.keyword_id)) prevMap.set(r.keyword_id, r.rank_position)
              })
              let dropped = 0
              latestMap.forEach((cur, id) => {
                const prev = prevMap.get(id)
                if (prev != null && prev <= 40 && cur != null && cur > 40) dropped++
              })
              if (dropped > 0) {
                list.push({
                  priority: 'warning',
                  source: '랭킹',
                  icon: '⚠️',
                  title: `1페이지 이탈 키워드 ${dropped}개 (${latestDate})`,
                  detail: `${prevDate} → ${latestDate} 동안 1페이지(상위 40위)에서 떨어진 키워드. 상품 노출 점검 필요.`,
                  link: { label: '랭킹 탭으로', href: '/ranking' },
                })
              }
            }
          }
        } catch (e) { /* 랭킹 데이터 없으면 무시 */ }
      } catch (e) {
        console.warn('[DashboardActionQueue]', e)
      }

      // 우선순위 정렬
      list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
      if (!cancelled) {
        setItems(list)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function go(href: string) {
    const nav = (window as Record<string, unknown>).navigateTo as ((p: string) => void) | undefined
    if (nav) nav(href)
    else window.location.href = href
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">🚨</div>
          <div>
            <div className="ch-title">우선순위 액션 큐</div>
            <div className="ch-sub">
              {loading ? '신호 분석 중...' :
                items.length === 0 ? '오늘 처리 필요한 신호 없음' :
                `처리 필요 ${items.length}건 · 위험 ${items.filter(i => i.priority === 'critical').length} · 주의 ${items.filter(i => i.priority === 'warning').length} · 기회 ${items.filter(i => i.priority === 'info').length}`}
            </div>
          </div>
        </div>
      </div>
      <div className="cb">
        {loading ? (
          <div style={{ padding: 8, fontSize: 12, color: '#94a3b8' }}>로드 중...</div>
        ) : items.length === 0 ? (
          <div style={{
            padding: 14, background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 8,
            fontSize: 13, color: '#065f46', fontWeight: 600, textAlign: 'center',
          }}>
            ✅ 처리 필요한 위험 신호가 없습니다. 정상 운영 중.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, i) => {
              const c = PRIORITY_COLOR[it.priority]
              return (
                <div key={i} style={{
                  background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8,
                  padding: '10px 12px',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}>
                  <div style={{
                    flexShrink: 0, fontSize: 9, fontWeight: 700, color: c.fg,
                    background: 'white', border: `1px solid ${c.border}`, borderRadius: 4,
                    padding: '2px 6px', whiteSpace: 'nowrap',
                  }}>
                    {c.tag}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: c.fg, marginBottom: 3 }}>
                      <span style={{ marginRight: 6 }}>{it.icon}</span>
                      <span style={{ opacity: 0.7, marginRight: 6, fontSize: 10 }}>[{it.source}]</span>
                      {it.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.5 }}>{it.detail}</div>
                  </div>
                  {it.link && (
                    <button
                      onClick={() => go(it.link!.href)}
                      style={{
                        flexShrink: 0, padding: '4px 10px', borderRadius: 4, border: 'none',
                        background: c.fg, color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}
                    >{it.link.label} →</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

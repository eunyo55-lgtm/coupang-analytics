'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toYMD } from '@/lib/dateUtils'

type Priority = 'critical' | 'warning' | 'info'

type ActionItem = {
  priority: Priority
  source: string
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

// ── 5분 TTL localStorage 캐시 (stale-while-revalidate) ──
const CACHE_KEY = 'dash_action_queue_v1'
const CACHE_TTL = 5 * 60 * 1000

function readCache(): { items: ActionItem[]; stale: boolean } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as { ts: number; items: ActionItem[] }
    if (!Array.isArray(c.items)) return null
    return { items: c.items, stale: Date.now() - c.ts > CACHE_TTL }
  } catch { return null }
}
function writeCache(items: ActionItem[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items })) } catch {}
}

/**
 * 모든 신호 감지 — 6개 쿼리를 병렬로 발사.
 * 가장 느린 쿼리 1개의 시간만 소요 (직렬 대비 평균 3-5배 빠름).
 * 일부 쿼리 실패해도 나머지로 진행 (Promise.allSettled).
 */
async function detectSignals(): Promise<ActionItem[]> {
  if (!supabase) return []
  const list: ActionItem[] = []
  const today = toYMD(new Date())
  const sevenDaysAgo = shiftDays(today, -7)
  const fourteenDaysAgo = shiftDays(today, -14)
  const threeDaysAgo = shiftDays(today, -3)

  const [invRes, campRes, kwAdRes, trackedRes, volsRes, ranksRes] = await Promise.allSettled([
    supabase.rpc('get_inventory_summary', { p_from: sevenDaysAgo, p_to: today }),
    supabase.rpc('get_ad_breakdown', { p_date_from: sevenDaysAgo, p_date_to: today, p_group_by: 'campaign' }),
    supabase.rpc('get_ad_breakdown', { p_date_from: sevenDaysAgo, p_date_to: today, p_group_by: 'keyword' }),
    supabase.from('keywords').select('keyword'),
    supabase.from('keyword_search_volumes').select('keyword, target_date, total_volume').gte('target_date', fourteenDaysAgo),
    // 최근 3일만 가져와 어제 vs 그제 비교에 충분
    supabase.from('keyword_rankings').select('keyword_id, date, rank_position').gte('date', threeDaysAgo).order('date', { ascending: false }),
  ])

  // ── 1) 재고 ──
  if (invRes.status === 'fulfilled' && Array.isArray((invRes.value as any).data)) {
    type Inv = { name: string; coupang_stock: number; daily_sales: number; days_left: number | null }
    const inv = (invRes.value as any).data as Inv[]
    const lows = inv.filter(r => r.coupang_stock === 0 && (r.daily_sales || 0) > 0)
                    .sort((a, b) => (b.daily_sales || 0) - (a.daily_sales || 0))
    if (lows.length > 0) {
      const lostDaily = lows.reduce((s, r) => s + (r.daily_sales || 0), 0)
      list.push({
        priority: 'critical', source: '재고', icon: '📦',
        title: `쿠팡 재고 0 + 판매 중 상품 ${lows.length}개`,
        detail: `일평균 ${fmt(lostDaily)}개 판매 손실 추정 · ` +
          lows.slice(0, 3).map(r => `${r.name.slice(0, 14)}(${fmt(r.daily_sales)}개/일)`).join(', ') +
          (lows.length > 3 ? ` 외 ${lows.length - 3}건` : ''),
        link: { label: '재고 탭에서 확인', href: '/inventory' },
      })
    }
    const imminent = inv.filter(r => r.coupang_stock > 0 && r.days_left != null && r.days_left <= 3)
                        .sort((a, b) => (a.days_left || 0) - (b.days_left || 0))
    if (imminent.length > 0) {
      list.push({
        priority: 'warning', source: '재고', icon: '⏳',
        title: `3일 내 재고 소진 임박 ${imminent.length}개`,
        detail: imminent.slice(0, 3).map(r => `${r.name.slice(0, 14)}(${r.days_left}일)`).join(', ') +
          (imminent.length > 3 ? ` 외 ${imminent.length - 3}건` : ''),
        link: { label: '공급 탭으로', href: '/supply' },
      })
    }
  } else if (invRes.status === 'rejected') {
    console.warn('[ActionQueue] inventory:', invRes.reason)
  }

  // ── 2) ROAS 미달 캠페인 ──
  if (campRes.status === 'fulfilled' && Array.isArray((campRes.value as any).data)) {
    type C = { name: string; ad_cost: number; revenue_14d: number }
    const under = ((campRes.value as any).data as C[])
      .map(c => ({
        name: c.name,
        cost: Number(c.ad_cost || 0),
        rev: Number(c.revenue_14d || 0),
        roas: Number(c.ad_cost || 0) > 0 ? Number(c.revenue_14d || 0) / Number(c.ad_cost || 0) : 0,
      }))
      .filter(c => c.cost >= 10000 && c.roas < 5)
      .sort((a, b) => a.roas - b.roas)
    if (under.length > 0) {
      const wasted = under.reduce((s, c) => s + c.cost, 0)
      list.push({
        priority: 'warning', source: '광고', icon: '📉',
        title: `ROAS 500% 미만 캠페인 ${under.length}개 (광고비 ${fmt(wasted)}원)`,
        detail: under.slice(0, 3).map(c => `${c.name.slice(0, 16)} (${(c.roas * 100).toFixed(0)}%)`).join(' · '),
        link: { label: '광고 탭에서 분석', href: '/ad' },
      })
    }
  }

  // ── 3) 미등록 광고 키워드 ──
  if (kwAdRes.status === 'fulfilled' && Array.isArray((kwAdRes.value as any).data) &&
      trackedRes.status === 'fulfilled' && (trackedRes.value as any).data) {
    type K = { name: string; revenue_14d: number }
    const trackedSet = new Set(((trackedRes.value as any).data as Array<{ keyword: string }>).map(k => k.keyword))
    const newOnes = ((kwAdRes.value as any).data as K[])
      .filter(k => k.name && k.name !== '(미지정)' && !trackedSet.has(k.name) && Number(k.revenue_14d || 0) > 50000)
      .sort((a, b) => Number(b.revenue_14d) - Number(a.revenue_14d))
    if (newOnes.length > 0) {
      const totalRev = newOnes.reduce((s, k) => s + Number(k.revenue_14d || 0), 0)
      list.push({
        priority: 'info', source: '키워드', icon: '🔍',
        title: `광고 매출 발생 중인 미등록 키워드 ${newOnes.length}개 (${fmt(totalRev)}원)`,
        detail: '상위: ' + newOnes.slice(0, 3).map(k => `"${k.name}"`).join(', '),
        link: { label: 'AI에 등록 위임', href: '/agent' },
      })
    }
  }

  // ── 4) 검색량 급등 ──
  if (volsRes.status === 'fulfilled' && Array.isArray((volsRes.value as any).data)) {
    type V = { keyword: string; target_date: string; total_volume: number }
    const cutoff = shiftDays(today, -7)
    const acc: Record<string, { recent: number[]; prev: number[] }> = {}
    for (const r of ((volsRes.value as any).data as V[])) {
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
        priority: 'info', source: '키워드', icon: '📈',
        title: `검색량 급등 키워드 ${surges.length}개 (전주 대비 +30% 이상)`,
        detail: surges.slice(0, 3).map(s => `"${s.keyword}" ▲${s.change_pct.toFixed(0)}% (${fmt(s.recent)}/일)`).join(', '),
        link: { label: '랭킹 탭에서 확인', href: '/ranking' },
      })
    }
  }

  // ── 5) 1페이지 이탈 ──
  if (ranksRes.status === 'fulfilled' && Array.isArray((ranksRes.value as any).data) && (ranksRes.value as any).data.length > 0) {
    type R = { keyword_id: number; date: string; rank_position: number | null }
    const ranks = (ranksRes.value as any).data as R[]
    const sorted = ranks.sort((a, b) => b.date.localeCompare(a.date))
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
          priority: 'warning', source: '랭킹', icon: '⚠️',
          title: `1페이지 이탈 키워드 ${dropped}개 (${latestDate})`,
          detail: `${prevDate} → ${latestDate} 동안 1페이지(상위 40위)에서 떨어진 키워드. 상품 노출 점검 필요.`,
          link: { label: '랭킹 탭으로', href: '/ranking' },
        })
      }
    }
  }

  list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
  return list
}

export default function DashboardActionQueue() {
  // 캐시가 있으면 즉시 화면 표시 (체감 로딩 0초)
  const initial = readCache()
  const [items, setItems] = useState<ActionItem[]>(initial?.items || [])
  const [loaded, setLoaded] = useState<boolean>(initial !== null)
  const [refreshing, setRefreshing] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    // 캐시가 stale이거나 없으면 백그라운드 fresh fetch
    const needFresh = !initial || initial.stale
    if (!needFresh) return  // 캐시 신선 — 추가 fetch 불필요

    setRefreshing(true)
    detectSignals().then(fresh => {
      if (cancelled) return
      setItems(fresh)
      writeCache(fresh)
      setLoaded(true)
      setRefreshing(false)
    }).catch(e => {
      if (cancelled) return
      console.warn('[DashboardActionQueue]', e)
      setLoaded(true)
      setRefreshing(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function go(href: string) {
    const nav = (window as Record<string, unknown>).navigateTo as ((p: string) => void) | undefined
    if (nav) nav(href)
    else window.location.href = href
  }

  function manualRefresh() {
    setRefreshing(true)
    detectSignals().then(fresh => {
      setItems(fresh)
      writeCache(fresh)
      setLoaded(true)
      setRefreshing(false)
    }).catch(() => setRefreshing(false))
  }

  const cnt = {
    critical: items.filter(i => i.priority === 'critical').length,
    warning:  items.filter(i => i.priority === 'warning').length,
    info:     items.filter(i => i.priority === 'info').length,
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">🚨</div>
          <div>
            <div className="ch-title">
              우선순위 액션 큐
              {refreshing && <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>· 갱신 중...</span>}
            </div>
            <div className="ch-sub">
              {!loaded ? '신호 분석 중...' :
                items.length === 0 ? '오늘 처리 필요한 신호 없음' :
                `처리 필요 ${items.length}건 · 위험 ${cnt.critical} · 주의 ${cnt.warning} · 기회 ${cnt.info}`}
            </div>
          </div>
        </div>
        <button
          onClick={manualRefresh}
          disabled={refreshing}
          style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: 'var(--bg)', color: '#475569', border: '1px solid var(--border)',
            cursor: refreshing ? 'not-allowed' : 'pointer',
            opacity: refreshing ? 0.5 : 1,
          }}
        >🔄 새로고침</button>
      </div>
      <div className="cb">
        {!loaded && items.length === 0 ? (
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

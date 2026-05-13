'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

function go(href: string) {
  const nav = (window as Record<string, unknown>).navigateTo as ((p: string) => void) | undefined
  if (nav) nav(href)
  else window.location.href = href
}

interface Stats {
  trackedKws: number
  lastAdDate: string | null
  lastSalesDate: string | null
  lastRankDate: string | null
}

/**
 * 각 탭으로 진입하는 카드 — 1줄 요약 + 클릭으로 이동.
 * 모바일에선 사이드바 대신 이 카드들로 네비게이션.
 */
export default function DashboardTabPortals() {
  const [stats, setStats] = useState<Stats>({
    trackedKws: 0, lastAdDate: null, lastSalesDate: null, lastRankDate: null,
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      try {
        const [kw, ad, sales, rank] = await Promise.all([
          supabase.from('keywords').select('id'),
          supabase.from('coupang_ad_daily_summary').select('date').order('date', { ascending: false }).limit(1),
          supabase.from('sales_data').select('sale_date').order('sale_date', { ascending: false }).limit(1),
          supabase.from('keyword_rankings').select('date').order('date', { ascending: false }).limit(1),
        ])
        if (cancelled) return
        setStats({
          trackedKws: kw.data?.length ?? 0,
          lastAdDate: ad.data?.[0]?.date ?? null,
          lastSalesDate: sales.data?.[0]?.sale_date ?? null,
          lastRankDate: rank.data?.[0]?.date ?? null,
        })
      } catch (e) {
        console.warn('[DashboardTabPortals]', e)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const dayDiff = (date: string | null) => {
    if (!date) return null
    const a = new Date(date + 'T00:00:00').getTime()
    const b = new Date(today + 'T00:00:00').getTime()
    return Math.round((b - a) / 86400000)
  }
  const freshLabel = (date: string | null) => {
    const d = dayDiff(date)
    if (d == null) return '데이터 없음'
    if (d === 0) return '오늘 최신'
    if (d === 1) return '어제까지'
    return `${d}일 전`
  }
  const freshColor = (date: string | null) => {
    const d = dayDiff(date)
    if (d == null || d > 7) return '#dc2626'
    if (d > 2) return '#f59e0b'
    return '#16a34a'
  }

  const portals = [
    { icon: '📊', label: '판매',       href: '/sales',      badge: stats.lastSalesDate ? freshLabel(stats.lastSalesDate) : '데이터 없음', color: '#1d4ed8', badgeColor: freshColor(stats.lastSalesDate) },
    { icon: '📦', label: '재고',       href: '/inventory',  badge: '현황 보기',       color: '#10b981', badgeColor: '#64748b' },
    { icon: '🚚', label: '공급/발주',  href: '/supply',     badge: '발주 관리',       color: '#7c3aed', badgeColor: '#64748b' },
    { icon: '🔍', label: '랭킹',       href: '/ranking',    badge: stats.lastRankDate ? freshLabel(stats.lastRankDate) : '데이터 없음', color: '#0891b2', badgeColor: freshColor(stats.lastRankDate) },
    { icon: '📣', label: '광고',       href: '/ad',         badge: stats.lastAdDate ? freshLabel(stats.lastAdDate) : '데이터 없음', color: '#ef4444', badgeColor: freshColor(stats.lastAdDate) },
    { icon: '🤖', label: 'AI 어시스턴트', href: '/agent',    badge: '대화 시작',       color: '#a855f7', badgeColor: '#64748b' },
    { icon: '🗄', label: '데이터 관리', href: '/datamanage', badge: '업로드/정리',     color: '#475569', badgeColor: '#64748b' },
  ]

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
        🔗 탭 바로가기
        <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 11, marginLeft: 6 }}>
          (추적 키워드 {stats.trackedKws}개)
        </span>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8,
      }}>
        {portals.map(p => (
          <button
            key={p.href}
            onClick={() => go(p.href)}
            style={{
              background: 'white', border: '1px solid #e2e8f0', borderLeft: `3px solid ${p.color}`,
              borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
              display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'inherit',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'
              ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'
              ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
              {p.icon} {p.label}
            </div>
            <div style={{ fontSize: 10, color: p.badgeColor, fontWeight: 600 }}>
              {p.badge}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

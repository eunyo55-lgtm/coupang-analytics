'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatKorean } from '@/lib/dateUtils'
import { useApp } from '@/lib/store'

const NAV_ITEMS = [
  { section: '메인', items: [
    { path: '/',          icon: '🏠', label: '대시보드' },
    { path: '/sales',     icon: '📊', label: '판매 현황' },
    { path: '/inventory', icon: '📦', label: '재고 현황' },
    { path: '/supply',    icon: '🚚', label: '공급 현황' },
  ]},
  { section: '채널 분석', items: [
    { path: '/ranking',   icon: '🏆', label: '랭킹 현황',  badge: 'rank' },
    { path: '/ad',        icon: '📣', label: '광고 현황' },
  ]},
  { section: '관리', items: [
    { path: '/datamanage', icon: '🗂️', label: '데이터 관리', badge: 'alert' },
  ]},
]

export default function Sidebar() {
  const pathname = usePathname()
  const { state } = useApp()
  const today = new Date()

  const alertCount = state.inventory.filter(i => i.status === 'danger').length
  const rankCount  = state.rankings.length

  function getBadge(key?: string) {
    if (key === 'rank'  && rankCount  > 0) return rankCount
    if (key === 'alert' && alertCount > 0) return alertCount
    return null
  }

  return (
    <aside className="sb">
      <div className="sb-top">
        <div className="sb-logo">
          <div className="sb-mark">🚀</div>
          <div>
            <div className="sb-name">Coupang<br />Analytics</div>
          </div>
        </div>
      </div>

      {NAV_ITEMS.map(group => (
        <div key={group.section}>
          <div className="sb-sec">{group.section}</div>
          {group.items.map(item => {
            const badge = getBadge(item.badge)
            const isActive = pathname === item.path
            return (
              <Link key={item.path} href={item.path} className={`ni${isActive ? ' active' : ''}`}>
                <div className="ni-ico">{item.icon}</div>
                <span className="ni-lbl">{item.label}</span>
                {badge !== null && (
                  <span className={`nb ${item.badge === 'alert' ? 'nb-r' : 'nb-b'}`}>
                    {badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}

      <div className="sb-foot">
        <div className="sb-datecard">
          <span style={{ fontSize: 14 }}>📅</span>
          <div>
            <div className="sb-date-text">{formatKorean(today)}</div>
            <div className="sb-date-sub">오늘 기준</div>
          </div>
          <div className="sb-dot" />
        </div>
      </div>
    </aside>
  )
}

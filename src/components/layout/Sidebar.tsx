'use client'

import { useApp } from '@/lib/store'
import { formatKorean } from '@/lib/dateUtils'

// 섹션 없이 flat 하게 순서대로 표시
const NAV_ITEMS: Array<{ path: string; key: string; icon: string; label: string; badge?: string }> = [
  { path: '/sales',      key: 'sales',      icon: '📊', label: '판매 현황' },
  { path: '/inventory',  key: 'inventory',  icon: '📦', label: '재고 현황' },
  { path: '/supply',     key: 'supply',     icon: '🚚', label: '공급 현황' },
  { path: '/ad',         key: 'ad',         icon: '📣', label: '광고 현황' },
  { path: '/datamanage', key: 'datamanage', icon: '🗂️', label: '데이터 관리', badge: 'alert' },
]

function navigateTo(path: string) {
  const nav = (window as unknown as Record<string, unknown>).navigateTo as ((p: string) => void) | undefined
  if (nav) nav(path)
  else window.location.href = path
}

export default function Sidebar({ currentTab }: { currentTab?: string }) {
  const { state } = useApp()
  const today = new Date()
  const alertCount = state.inventory.filter(i => i.status === 'danger').length

  function getBadge(badge?: string) {
    if (badge === 'alert' && alertCount > 0) return alertCount
    return null
  }

  return (
    <aside className="sb">
      <div className="sb-top">
        <div className="sb-logo">
          <div className="sb-mark" onClick={() => navigateTo('/sales')} style={{ cursor: 'pointer' }}>🚀</div>
          <div>
            <div className="sb-name">Coupang<br />Analytics</div>
          </div>
        </div>
      </div>

      {NAV_ITEMS.map(item => {
        const badge = getBadge(item.badge)
        const isActive = currentTab === item.key
        return (
          <button
            key={item.path}
            className={`ni${isActive ? ' active' : ''}`}
            onClick={() => navigateTo(item.path)}
            style={{ width: '100%', background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
          >
            <div className="ni-ico">{item.icon}</div>
            <span className="ni-lbl">{item.label}</span>
            {badge !== null && (
              <span className={`nb nb-r`}>{badge}</span>
            )}
          </button>
        )
      })}

      <div className="sb-foot">
        <div className="sb-datecard">
          <div>
            <div className="sb-date-text">{formatKorean(today)}</div>
            <div className="sb-date-sub">{state.hasData ? '오늘 기준' : '데이터 없음'}</div>
          </div>
          {state.hasData && <span className="sb-dot" />}
        </div>
      </div>
    </aside>
  )
}

'use client'

import { useApp } from '@/lib/store'
import { formatKorean } from '@/lib/dateUtils'

const NAV = [
  { group: '메인', items: [
    { key: 'dashboard', label: '대시보드', icon: '🏠', path: '/' },
    { key: 'sales',     label: '판매 현황', icon: '📊', path: '/sales' },
    { key: 'inventory', label: '재고 현황', icon: '📦', path: '/inventory' },
    { key: 'supply',    label: '공급 현황', icon: '🚚', path: '/supply' },
  ]},
  { group: '채널 분석', items: [
    { key: 'ranking', label: '랭킹 현황', icon: '🏆', path: '/ranking' },
    { key: 'ad',      label: '광고 현황', icon: '📢', path: '/ad' },
  ]},
  { group: '관리', items: [
    { key: 'datamanage', label: '데이터 관리', icon: '🗂️', path: '/datamanage' },
  ]},
]

export default function Sidebar({ currentTab }: { currentTab?: string }) {
  const { state } = useApp()
  const today = new Date()

  function go(path: string) {
    const nav = (window as unknown as Record<string,unknown>).navigateTo as ((p:string)=>void) | undefined
    if (nav) nav(path)
    else window.location.href = path
  }

  return (
    <aside className="sidebar">
      <div className="sb-logo" onClick={() => go('/')} style={{ cursor:'pointer' }}>
        <div className="sb-logo-icon">🛒</div>
        <div className="sb-logo-text">
          <div className="sb-logo-title">Coupang</div>
          <div className="sb-logo-sub">Analytics</div>
        </div>
      </div>

      <nav className="sb-nav">
        {NAV.map(({ group, items }) => (
          <div key={group} className="sb-group">
            <div className="sb-group-label">{group}</div>
            {items.map(({ key, label, icon, path }) => {
              const active = currentTab === key || (currentTab === 'dashboard' && key === 'dashboard')
              return (
                <button key={key} className={`sb-item${active ? ' active' : ''}`} onClick={() => go(path)}>
                  <span className="sb-item-icon">{icon}</span>
                  <span className="sb-item-label">{label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sb-footer">
        <div className="sb-date">{formatKorean(today)}</div>
        <div className="sb-status">
          <span className={`sb-dot ${state.hasData ? 'on' : 'off'}`} />
          {state.hasData ? '오늘 기준' : '데이터 없음'}
        </div>
      </div>
    </aside>
  )
}

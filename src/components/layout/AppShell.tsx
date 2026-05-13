'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/lib/store'
import Sidebar from '@/components/layout/Sidebar'

// 각 탭 컴포넌트 import
import DashboardPage from '@/app/_pages/DashboardPage'
import SalesPage from '@/app/_pages/SalesPage'
import InventoryPage from '@/app/_pages/InventoryPage'
import SupplyPage from '@/app/_pages/SupplyPage'
import RankingPage from '@/app/_pages/RankingPage'
import AdPage from '@/app/_pages/AdPage'
import DataManagePage from '@/app/_pages/DataManagePage'
import AgentPage from '@/app/_pages/AgentPage'

const TABS: Record<string, React.ComponentType> = {
  '':          DashboardPage,
  'dashboard': DashboardPage,
  'sales':     SalesPage,
  'inventory': InventoryPage,
  'supply':    SupplyPage,
  'ranking':   RankingPage,
  'ad':        AdPage,
  'datamanage': DataManagePage,
  'agent':     AgentPage,
}

export default function AppShell() {
  const { isReady } = useApp()
  const [tab, setTab] = useState('dashboard')

  useEffect(() => {
    // URL pathname에서 탭 읽기
    const getTab = () => {
      const path = window.location.pathname.replace('/', '').trim()
      setTab(path || 'dashboard')
    }
    getTab()
    window.addEventListener('popstate', getTab)
    return () => window.removeEventListener('popstate', getTab)
  }, [])

  // SPA 네비게이션 함수를 window에 등록
  useEffect(() => {
    (window as unknown as Record<string,unknown>).navigateTo = (path: string) => {
      window.history.pushState({}, '', path)
      const t = path.replace('/', '').trim()
      setTab(t || 'dashboard')
    }
  }, [])

  const PageComponent = TABS[tab] || DashboardPage

  if (!isReady) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', flexDirection:'column', gap:16, color:'var(--t3)' }}>
        <div style={{ width:36, height:36, border:'3px solid var(--border)', borderTopColor:'var(--blue)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
        <p style={{ fontSize:13, fontWeight:600 }}>데이터 불러오는 중...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <div className="layout">
      <Sidebar currentTab={tab} />
      <div className="main">
        <div className="content">
          <PageComponent />
        </div>
      </div>
    </div>
  )
}

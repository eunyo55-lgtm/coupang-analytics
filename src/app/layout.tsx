import type { Metadata } from 'next'
import { AppProvider } from '@/lib/store'
import Sidebar from '@/components/layout/Sidebar'
import DateFilterBar from '@/components/layout/DateFilterBar'
import AppReadyGate from '@/components/layout/AppReadyGate'
import './globals.css'

export const metadata: Metadata = {
  title: 'Coupang Analytics',
  description: '쿠팡 채널 통합 관리 대시보드',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppProvider>
          <div className="layout">
            <Sidebar />
            <div className="main">
              <DateFilterBar />
              <div className="content">
                <AppReadyGate>{children}</AppReadyGate>
              </div>
            </div>
          </div>
        </AppProvider>
      </body>
    </html>
  )
}

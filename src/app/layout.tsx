import type { Metadata } from 'next'
import { AppProvider } from '@/lib/store'
import AppShell from '@/components/layout/AppShell'
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
          <AppShell />
        </AppProvider>
      </body>
    </html>
  )
}

'use client'
import { useApp } from '@/lib/store'

export default function AppReadyGate({ children }: { children: React.ReactNode }) {
  const { isReady } = useApp()

  if (!isReady) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '60vh', flexDirection: 'column', gap: 16, color: 'var(--t3)'
      }}>
        <div style={{
          width: 36, height: 36, border: '3px solid var(--border)',
          borderTopColor: 'var(--blue)', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        <p style={{ fontSize: 13, fontWeight: 600 }}>데이터 불러오는 중...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return <>{children}</>
}

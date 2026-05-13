'use client'
import { useEffect, useRef, useState } from 'react'

type Job = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  started_at: string | null
  finished_at: string | null
  triggered_by: string | null
  error: string | null
  logs?: string | null
}

const fmtKST = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(5, 16).replace('T', ' ')
}

function StatusBadge({ status }: { status: Job['status'] }) {
  const colors: Record<Job['status'], { bg: string; fg: string; label: string }> = {
    pending:   { bg: '#fef3c7', fg: '#92400e', label: '대기 중' },
    running:   { bg: '#dbeafe', fg: '#1e40af', label: '실행 중' },
    completed: { bg: '#d1fae5', fg: '#065f46', label: '완료' },
    failed:    { bg: '#fee2e2', fg: '#991b1b', label: '실패' },
  }
  const c = colors[status] || colors.failed
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
      {c.label}
    </span>
  )
}

export default function RankingBotTrigger() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedLogs, setExpandedLogs] = useState<Record<string, string>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function loadJobs() {
    try {
      const res = await fetch('/api/trigger-ranking-bot', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      setJobs(j.jobs || [])
    } catch { /* ignore */ }
  }

  async function loadJobDetail(id: string) {
    try {
      const res = await fetch(`/api/trigger-ranking-bot?id=${id}`, { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      if (j.job?.logs) setExpandedLogs(prev => ({ ...prev, [id]: j.job.logs }))
    } catch { /* ignore */ }
  }

  async function triggerBot() {
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/trigger-ranking-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: 'web' }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || '요청 실패')
      await loadJobs()
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  // 초기 로드 + 진행 중 작업 있으면 빠른 polling
  useEffect(() => {
    loadJobs()
    pollRef.current = setInterval(() => {
      const hasActive = jobs.some(j => j.status === 'pending' || j.status === 'running')
      if (hasActive) loadJobs()
    }, 5000) // 5초마다 활성 작업이 있으면 갱신
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length, jobs.map(j => j.status).join(',')])

  const latest = jobs[0]
  const isActive = latest && (latest.status === 'pending' || latest.status === 'running')

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16, background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>🤖 랭킹 수집 봇</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            회사 PC의 봇을 원격으로 실행합니다. 결과는 자동으로 DB에 저장됩니다.
          </div>
        </div>
        <button
          onClick={triggerBot}
          disabled={busy || isActive}
          style={{
            padding: '8px 18px',
            background: busy || isActive ? '#cbd5e1' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 13,
            cursor: busy || isActive ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? '요청 중…' : isActive ? '진행 중…' : '수집 시작'}
        </button>
      </div>

      {errorMsg && (
        <div style={{ marginTop: 8, padding: 8, background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>
          {errorMsg}
        </div>
      )}

      {jobs.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#64748b', fontWeight: 600 }}>
            최근 실행 기록 ({jobs.length})
          </summary>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>요청</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>완료</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>상태</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>주체</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <>
                    <tr key={j.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px', color: '#334155' }}>{fmtKST(j.created_at)}</td>
                      <td style={{ padding: '6px 8px', color: '#334155' }}>{fmtKST(j.finished_at)}</td>
                      <td style={{ padding: '6px 8px' }}><StatusBadge status={j.status} /></td>
                      <td style={{ padding: '6px 8px', color: '#64748b' }}>{j.triggered_by || '-'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button
                          onClick={() => {
                            if (expandedId === j.id) { setExpandedId(null); return }
                            setExpandedId(j.id)
                            loadJobDetail(j.id)
                          }}
                          style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11 }}
                        >
                          {expandedId === j.id ? '닫기' : '로그'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === j.id && (
                      <tr>
                        <td colSpan={5} style={{ padding: 8, background: '#0f172a', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 240, overflowY: 'auto' }}>
                          {j.error && <div style={{ color: '#fca5a5', marginBottom: 4 }}>error: {j.error}</div>}
                          {expandedLogs[j.id] || '(로그 없음)'}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}

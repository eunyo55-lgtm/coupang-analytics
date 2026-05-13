'use client'
import { useEffect, useRef, useState } from 'react'

type JobType = 'coupang_rank' | 'naver_volume'

type Job = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  job_type: JobType
  created_at: string
  started_at: string | null
  finished_at: string | null
  triggered_by: string | null
  error: string | null
  logs?: string | null
}

const BOT_META: Record<JobType, { label: string; icon: string; color: string }> = {
  coupang_rank: { label: '쿠팡 랭킹', icon: '🛒', color: '#2563eb' },
  naver_volume: { label: '네이버 검색량', icon: '🔍', color: '#10b981' },
}

const fmtKST = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(5, 16).replace('T', ' ')
}

const STATUS_LABEL: Record<Job['status'], string> = {
  pending: '대기 중',
  running: '실행 중',
  completed: '완료',
  failed: '실패',
}
const STATUS_COLOR: Record<Job['status'], string> = {
  pending: '#f59e0b',
  running: '#3b82f6',
  completed: '#10b981',
  failed: '#ef4444',
}

export default function RankingBotTrigger() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [busyType, setBusyType] = useState<JobType | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function loadJobs() {
    try {
      const res = await fetch('/api/trigger-ranking-bot', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      setJobs(j.jobs || [])
    } catch { /* ignore */ }
  }

  async function triggerBot(jobType: JobType) {
    setBusyType(jobType)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/trigger-ranking-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: 'web', job_type: jobType }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || '요청 실패')
      await loadJobs()
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setBusyType(null)
    }
  }

  useEffect(() => {
    loadJobs()
    pollRef.current = setInterval(() => {
      const hasActive = jobs.some(j => j.status === 'pending' || j.status === 'running')
      if (hasActive) loadJobs()
    }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length, jobs.map(j => j.status + j.job_type).join(',')])

  const latestByType = (t: JobType) => jobs.find(j => j.job_type === t) || null
  const activeByType = (t: JobType) => {
    const j = latestByType(t)
    return j && (j.status === 'pending' || j.status === 'running')
  }

  function renderCompactButton(jobType: JobType) {
    const meta = BOT_META[jobType]
    const latest = latestByType(jobType)
    const isBusy = busyType === jobType
    const isActive = activeByType(jobType)
    const statusText = latest ? STATUS_LABEL[latest.status] : '대기'
    const statusColor = latest ? STATUS_COLOR[latest.status] : '#94a3b8'

    return (
      <div key={jobType} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => triggerBot(jobType)}
          disabled={isBusy || isActive}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999, border: 'none',
            background: isBusy || isActive ? '#cbd5e1' : meta.color,
            color: 'white', fontSize: 12, fontWeight: 600,
            cursor: isBusy || isActive ? 'not-allowed' : 'pointer',
          }}
          title={meta.label}
        >
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
          <span style={{ opacity: 0.9 }}>{isBusy ? '요청 중…' : isActive ? '진행 중…' : '수집'}</span>
        </button>
        {latest && (
          <span style={{ fontSize: 11, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
            {statusText} · {fmtKST(latest.finished_at || latest.started_at || latest.created_at)}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: '8px 14px', marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>🤖 데이터 수집</span>
        {renderCompactButton('coupang_rank')}
        {renderCompactButton('naver_volume')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {errorMsg && (
          <span style={{ fontSize: 11, color: '#ef4444' }}>{errorMsg.slice(0, 80)}</span>
        )}
        {jobs.length > 0 && (
          <button
            onClick={() => setShowHistory(s => !s)}
            style={{
              background: 'none', border: '1px solid #e2e8f0',
              color: '#64748b', fontSize: 11, fontWeight: 600,
              padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            }}
          >
            {showHistory ? '기록 닫기' : `실행 기록 (${jobs.length})`}
          </button>
        )}
      </div>

      {showHistory && jobs.length > 0 && (
        <div style={{ width: '100%', marginTop: 8, fontSize: 11, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thStyle()}>봇</th>
                <th style={thStyle()}>요청</th>
                <th style={thStyle()}>완료</th>
                <th style={thStyle()}>상태</th>
                <th style={thStyle()}>주체</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={tdStyle()}>{BOT_META[j.job_type]?.icon} {BOT_META[j.job_type]?.label}</td>
                  <td style={tdStyle()}>{fmtKST(j.created_at)}</td>
                  <td style={tdStyle()}>{fmtKST(j.finished_at)}</td>
                  <td style={tdStyle()}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: STATUS_COLOR[j.status] }}>
                      ● {STATUS_LABEL[j.status]}
                    </span>
                  </td>
                  <td style={tdStyle()}>{j.triggered_by || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function thStyle(): React.CSSProperties {
  return { padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }
}
function tdStyle(): React.CSSProperties {
  return { padding: '6px 8px', color: '#334155' }
}

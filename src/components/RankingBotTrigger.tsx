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

const BOT_META: Record<JobType, { label: string; icon: string; desc: string; color: string }> = {
  coupang_rank: {
    label: '쿠팡 랭킹 수집',
    icon: '🛒',
    desc: '키워드별 쿠팡 검색 결과에서 우리 상품 순위를 추적합니다.',
    color: '#2563eb',
  },
  naver_volume: {
    label: '네이버 검색량 수집',
    icon: '🔍',
    desc: '네이버 검색광고 API로 키워드 월간 PC/모바일 검색량을 가져옵니다.',
    color: '#10b981',
  },
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

function JobTypeBadge({ type }: { type: JobType }) {
  const m = BOT_META[type]
  return (
    <span style={{ fontSize: 11, color: '#64748b' }}>
      {m.icon} {m.label.replace(' 수집', '')}
    </span>
  )
}

export default function RankingBotTrigger() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [busyType, setBusyType] = useState<JobType | null>(null)
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

  // 봇별 활성 여부
  const activeByType = (t: JobType) =>
    jobs.some(j => j.job_type === t && (j.status === 'pending' || j.status === 'running'))

  function renderTriggerCard(jobType: JobType) {
    const meta = BOT_META[jobType]
    const isActive = activeByType(jobType)
    const isBusy = busyType === jobType
    return (
      <div
        key={jobType}
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: '#fafafa',
          minWidth: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
            {meta.icon} {meta.label}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
            {meta.desc}
          </div>
        </div>
        <button
          onClick={() => triggerBot(jobType)}
          disabled={isBusy || isActive}
          style={{
            padding: '8px 12px',
            background: isBusy || isActive ? '#cbd5e1' : meta.color,
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 12,
            cursor: isBusy || isActive ? 'not-allowed' : 'pointer',
          }}
        >
          {isBusy ? '요청 중…' : isActive ? '진행 중…' : '수집 시작'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16, background: 'white' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>🤖 데이터 수집 봇</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          회사 PC의 봇을 원격으로 실행합니다. 결과는 자동으로 DB에 저장됩니다.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {renderTriggerCard('coupang_rank')}
        {renderTriggerCard('naver_volume')}
      </div>

      {errorMsg && (
        <div style={{ marginTop: 10, padding: 8, background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>
          {errorMsg}
        </div>
      )}

      {jobs.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#64748b', fontWeight: 600 }}>
            최근 실행 기록 ({jobs.length})
          </summary>
          <div style={{ marginTop: 8, fontSize: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>봇</th>
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
                      <td style={{ padding: '6px 8px' }}><JobTypeBadge type={j.job_type} /></td>
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
                        <td colSpan={6} style={{ padding: 8, background: '#0f172a', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 240, overflowY: 'auto' }}>
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

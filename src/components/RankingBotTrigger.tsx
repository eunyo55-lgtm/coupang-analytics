'use client'
import { useEffect, useRef, useState } from 'react'

type JobType = 'coupang_rank' | 'naver_volume' | 'coupang_category'

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
  coupang_rank:     { label: '쿠팡 랭킹',     icon: '🛒', color: '#2563eb' },
  naver_volume:     { label: '네이버 검색량', icon: '🔍', color: '#10b981' },
  coupang_category: { label: '카테고리 노출', icon: '📂', color: '#7c3aed' },
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

  // 두 봇을 한 번에 트리거 (이미 진행 중인 건 스킵)
  async function triggerAll() {
    setErrorMsg(null)
    const types: JobType[] = ['coupang_rank', 'naver_volume', 'coupang_category']
    for (const t of types) {
      if (activeByType(t)) continue  // 이미 pending/running이면 스킵
      setBusyType(t)
      try {
        const res = await fetch('/api/trigger-ranking-bot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggered_by: 'web', job_type: t }),
        })
        const j = await res.json()
        if (!res.ok && res.status !== 409) throw new Error(j?.error || '요청 실패')
      } catch (e: any) {
        setErrorMsg(e?.message ?? String(e))
      }
    }
    setBusyType(null)
    await loadJobs()
  }

  async function cancelJob(id: string) {
    if (!confirm('이 작업을 취소하시겠습니까? (로컬 봇이 안 켜져 있으면 큐를 비우는 데 유용합니다.)')) return
    try {
      const res = await fetch(`/api/trigger-ranking-bot?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || '취소 실패')
      }
      await loadJobs()
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    }
  }

  // 봇 오프라인 감지: pending 작업이 2분 이상 멈춰 있으면 runner가 안 돌고 있다는 신호.
  // runner는 15초마다 polling 하므로 정상이라면 30초 안에 'running'으로 바뀐다.
  function isLikelyOffline(j: Job): boolean {
    if (j.status !== 'pending') return false
    const createdMs = new Date(j.created_at).getTime()
    return Date.now() - createdMs > 2 * 60 * 1000
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
    const offline = latest ? isLikelyOffline(latest) : false
    const statusText = latest ? STATUS_LABEL[latest.status] : '대기'
    const statusColor = latest ? STATUS_COLOR[latest.status] : '#94a3b8'

    return (
      <div key={jobType} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: offline ? '#ef4444' : statusColor }} />
            {statusText} · {fmtKST(latest.finished_at || latest.started_at || latest.created_at)}
          </span>
        )}
        {offline && latest && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b',
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          }}>
            🔌 봇 오프라인 의심
            <button
              onClick={() => cancelJob(latest.id)}
              style={{
                background: '#991b1b', color: 'white', border: 'none', borderRadius: 4,
                padding: '1px 6px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >취소</button>
          </span>
        )}
      </div>
    )
  }

  // 통합 상태: 세 봇 중 하나라도 진행 중이면 active
  const anyActive = activeByType('coupang_rank') || activeByType('naver_volume') || activeByType('coupang_category')
  const anyBusy = busyType !== null
  const anyOffline = jobs.some(isLikelyOffline)
  const latestCoupang  = latestByType('coupang_rank')
  const latestNaver    = latestByType('naver_volume')
  const latestCategory = latestByType('coupang_category')

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: '8px 14px', marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={triggerAll}
          disabled={anyBusy || anyActive}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', borderRadius: 999, border: 'none',
            background: anyBusy || anyActive ? '#cbd5e1' : '#2563eb',
            color: 'white', fontSize: 13, fontWeight: 700,
            cursor: anyBusy || anyActive ? 'not-allowed' : 'pointer',
          }}
        >
          🤖 데이터 수집 {anyBusy ? '· 요청 중…' : anyActive ? '· 진행 중…' : ''}
        </button>
        {(latestCoupang || latestNaver || latestCategory) && (
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
            {latestCoupang && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[latestCoupang.status] }} />
                🛒 {STATUS_LABEL[latestCoupang.status]} {fmtKST(latestCoupang.finished_at || latestCoupang.started_at || latestCoupang.created_at)}
              </span>
            )}
            {latestNaver && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[latestNaver.status] }} />
                🔍 {STATUS_LABEL[latestNaver.status]} {fmtKST(latestNaver.finished_at || latestNaver.started_at || latestNaver.created_at)}
              </span>
            )}
            {latestCategory && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[latestCategory.status] }} />
                📂 {STATUS_LABEL[latestCategory.status]} {fmtKST(latestCategory.finished_at || latestCategory.started_at || latestCategory.created_at)}
              </span>
            )}
          </div>
        )}
        {anyOffline && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b',
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          }}>
            🔌 봇 오프라인
            <button
              onClick={async () => {
                try {
                  await fetch('/api/trigger-ranking-bot', { method: 'DELETE' })
                  await loadJobs()
                } catch {}
              }}
              style={{
                background: '#991b1b', color: 'white', border: 'none', borderRadius: 4,
                padding: '1px 6px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >대기 취소</button>
          </span>
        )}
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

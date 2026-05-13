'use client'
import { useEffect, useMemo, useState } from 'react'

interface AdDaily {
  date: string
  ad_cost: number
}

interface Props {
  csvDailyAll: AdDaily[]
}

const BUDGET_KEY = 'coupang_ad_monthly_budget_v1'
const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

function todayKST(): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  return d.toISOString().slice(0, 10)
}

/**
 * 월 광고 예산 페이스 — 사용자가 월 예산 입력하면 현재 사용량/예상 월말 비교.
 *   사용 X원 / 예산 Y원 (Z%) — 진행률 바
 *   일평균 사용 + 예상 월말 = 추세 기반 추정
 *   초과 예상이면 🔴 + "남은 일수에 일평균 N원 이하로" 가이드
 *   여유 있으면 🟢 + 절감 가능액 표시
 *
 * 예산은 localStorage(BUDGET_KEY)에 저장 — 디바이스/브라우저별.
 * (멀티 디바이스 동기화 필요하면 Supabase user_settings 테이블로 옮기는 게 나음)
 */
export default function AdBudgetPacing({ csvDailyAll }: Props) {
  const [budget, setBudget] = useState<number>(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(BUDGET_KEY) : null
    if (stored) {
      const n = Number(stored)
      if (Number.isFinite(n) && n > 0) {
        setBudget(n)
        setDraft(String(n))
      }
    }
  }, [])

  function saveBudget() {
    const cleaned = draft.replace(/[,\s원]/g, '')
    const n = Number(cleaned)
    if (!Number.isFinite(n) || n < 0) {
      alert('숫자만 입력해주세요')
      return
    }
    setBudget(n)
    if (typeof window !== 'undefined') {
      if (n > 0) localStorage.setItem(BUDGET_KEY, String(n))
      else localStorage.removeItem(BUDGET_KEY)
    }
    setEditing(false)
  }

  // 이번 달 = today의 YYYY-MM (KST)
  const today = todayKST()
  const yyyymm = today.slice(0, 7)
  const [year, month] = yyyymm.split('-').map(Number)

  const stats = useMemo(() => {
    const monthRows = csvDailyAll.filter(r => r.date.startsWith(yyyymm))
    const monthCost = monthRows.reduce((s, r) => s + Number(r.ad_cost || 0), 0)
    const daysInMonth = new Date(year, month, 0).getDate()
    const dayOfMonth = Number(today.slice(8, 10))
    // 데이터가 있는 마지막 날까지를 "경과"로 본다 (오늘은 아직 데이터 없을 수 있음)
    const lastDataDate = monthRows.length > 0 ? monthRows[monthRows.length - 1].date : today
    const elapsedDays = Math.max(1, Math.min(Number(lastDataDate.slice(8, 10)), daysInMonth))
    const remainingDays = Math.max(0, daysInMonth - elapsedDays)
    const dailyAvg = monthCost / elapsedDays
    const projectedTotal = dailyAvg * daysInMonth
    return { monthCost, daysInMonth, elapsedDays, remainingDays, dailyAvg, projectedTotal, lastDataDate, dayOfMonth }
  }, [csvDailyAll, yyyymm, year, month, today])

  // 예산 미설정 + 편집 모드 아님 → 안내 카드
  if (budget === 0 && !editing) {
    return (
      <div style={{
        background: 'white', border: '1px dashed #cbd5e1', borderRadius: 8,
        padding: '10px 14px', marginBottom: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          💰 <b>월 광고 예산 페이스</b> — 월 예산을 설정하면 현재 사용량과 예상 월말 광고비를 추적합니다.
        </div>
        <button
          onClick={() => { setDraft(''); setEditing(true) }}
          style={{
            padding: '5px 14px', background: '#2563eb', color: 'white', border: 'none',
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >⚙️ 예산 설정하기</button>
      </div>
    )
  }

  if (editing) {
    return (
      <div style={{
        background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8,
        padding: '12px 14px', marginBottom: 12,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', marginBottom: 8 }}>
          💰 월 광고 예산 설정 ({yyyymm})
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text" inputMode="numeric"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="예: 5000000"
            style={{
              padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6,
              width: 180, fontFamily: 'inherit',
            }}
            onKeyDown={e => { if (e.key === 'Enter') saveBudget() }}
            autoFocus
          />
          <span style={{ fontSize: 12, color: '#475569' }}>원</span>
          <button
            onClick={saveBudget}
            style={{ padding: '6px 14px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >저장</button>
          <button
            onClick={() => setEditing(false)}
            style={{ padding: '6px 14px', background: 'white', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >취소</button>
          {budget > 0 && (
            <button
              onClick={() => { setDraft('0'); saveBudget() }}
              style={{ padding: '6px 14px', background: 'white', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}
            >🗑️ 예산 삭제</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
          현재 저장된 예산: {budget > 0 ? fmt(budget) + '원' : '없음'}
        </div>
      </div>
    )
  }

  // 정상 페이스 표시
  const usedPct = budget > 0 ? stats.monthCost / budget * 100 : 0
  const projectedPct = budget > 0 ? stats.projectedTotal / budget * 100 : 0
  const willOvershoot = projectedPct > 100
  const overshootAmount = stats.projectedTotal - budget
  const requiredDailyToFit = stats.remainingDays > 0 ? Math.max(0, (budget - stats.monthCost) / stats.remainingDays) : 0

  const usedBarColor = usedPct >= 100 ? '#dc2626' : usedPct >= 80 ? '#f59e0b' : '#16a34a'
  const cardBg = willOvershoot ? '#fef2f2' : projectedPct >= 80 ? '#fef3c7' : '#f0fdf4'
  const cardBorder = willOvershoot ? '#fca5a5' : projectedPct >= 80 ? '#fcd34d' : '#86efac'
  const headerColor = willOvershoot ? '#991b1b' : projectedPct >= 80 ? '#92400e' : '#15803d'

  return (
    <div style={{
      background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 8,
      padding: '12px 14px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: headerColor }}>
          💰 월 광고 예산 페이스 ({yyyymm}) — {stats.elapsedDays}일 경과 / {stats.daysInMonth}일
        </div>
        <button
          onClick={() => { setDraft(String(budget)); setEditing(true) }}
          style={{
            padding: '3px 10px', background: 'white', color: '#475569', border: '1px solid #cbd5e1',
            borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >⚙️ 예산 수정</button>
      </div>

      <div style={{ fontSize: 12, color: '#334155', marginBottom: 4 }}>
        사용 <b>{fmt(stats.monthCost)}원</b> / 예산 <b>{fmt(budget)}원</b>
        <span style={{ color: usedBarColor, fontWeight: 700, marginLeft: 6 }}>({usedPct.toFixed(1)}%)</span>
      </div>

      {/* 진행률 바 */}
      <div style={{ position: 'relative', height: 10, background: '#e2e8f0', borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{
          width: `${Math.min(100, usedPct)}%`, height: '100%', background: usedBarColor,
          transition: 'width 0.3s',
        }} />
        {/* 예상 월말 표시선 */}
        {projectedPct > usedPct && projectedPct <= 200 && (
          <div style={{
            position: 'absolute', left: `${Math.min(100, projectedPct)}%`, top: -2, bottom: -2,
            width: 2, background: willOvershoot ? '#dc2626' : '#64748b',
            transform: 'translateX(-1px)',
          }} title={`예상 월말: ${projectedPct.toFixed(0)}%`} />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, fontSize: 11 }}>
        <div style={{ color: '#475569' }}>
          일평균 사용: <b>{fmt(stats.dailyAvg)}원</b>
        </div>
        <div style={{ color: '#475569' }}>
          예상 월말: <b style={{ color: willOvershoot ? '#dc2626' : '#15803d' }}>{fmt(stats.projectedTotal)}원</b> ({projectedPct.toFixed(0)}%)
        </div>
        <div style={{ color: '#475569' }}>
          남은 일수: <b>{stats.remainingDays}일</b>
        </div>
      </div>

      {/* 알림 메시지 */}
      <div style={{
        marginTop: 8, padding: '8px 10px', background: 'white',
        borderLeft: `3px solid ${cardBorder}`, borderRadius: 4,
        fontSize: 11, color: '#334155', lineHeight: 1.55,
      }}>
        {willOvershoot ? (
          <>
            🔴 <b>예산 초과 예상</b> — 이 추세면 월말까지 <b>{fmt(overshootAmount)}원 초과</b>합니다.
            남은 {stats.remainingDays}일 동안 일평균 <b style={{ color: '#dc2626' }}>{fmt(requiredDailyToFit)}원 이하</b>로 줄여야 예산 안에서 마무리 가능.
            ROAS 미달 캠페인부터 입찰 인하/중지를 검토하세요.
          </>
        ) : projectedPct >= 80 ? (
          <>
            🟡 <b>예산 빠듯</b> — 예상 월말 사용액이 예산의 <b>{projectedPct.toFixed(0)}%</b>입니다.
            큰 이벤트나 신규 캠페인이 있다면 예산 증액을 미리 검토하세요.
          </>
        ) : (
          <>
            🟢 <b>여유 있음</b> — 예상 월말 사용액 {fmt(stats.projectedTotal)}원 (예산 대비 {(100 - projectedPct).toFixed(0)}% 절감 가능).
            고ROAS 캠페인 광고비 증액으로 매출 추가 확보를 검토할 수 있습니다.
          </>
        )}
      </div>
    </div>
  )
}

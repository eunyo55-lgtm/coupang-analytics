'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/lib/store'
import { parseFile, normalizeSalesData } from '@/lib/fileParser'
import type { ParseResult } from '@/types'

const FILE_CONFIG = [
  { key: 'master' as const, icon: '📋', title: '이지어드민 상품마스터', sub: '상품코드 · 상품명 · 옵션 · 재고' },
  { key: 'sales'  as const, icon: '🛒', title: '쿠팡 판매 데이터',      sub: '판매량 · 금액 · 날짜' },
  { key: 'orders' as const, icon: '📦', title: '쿠팡 발주서',           sub: '발주번호 · 수량' },
  { key: 'supply' as const, icon: '🚚', title: '공급 중 수량',          sub: '입고 대기 수량 · 예정일' },
]

export default function DataManagePage() {
  const { state, dispatch } = useApp()
  const router = useRouter()
  const [uploading,  setUploading]  = useState<Record<string, boolean>>({})
  const [fileNames,  setFileNames]  = useState<Record<string, string>>({})
  const [done,       setDone]       = useState<Record<string, boolean>>({})
  const [analyzing,  setAnalyzing]  = useState(false)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  async function handleFile(file: File, key: ParseResult['key']) {
    setUploading(u => ({ ...u, [key]: true }))
    const result = await parseFile(file, key)

    if (result.error) {
      dispatch({ type: 'APPEND_LOG', payload: `❌ [${key}] ${result.error}` })
    } else {
      const cols = result.columns.slice(0, 5).join(' · ') + (result.columns.length > 5 ? '…' : '')
      dispatch({ type: 'APPEND_LOG', payload: `✅ [${key}] 새 파일: ${result.rows.toLocaleString()}행 | ${cols}` })

      // Normalize sales data immediately
      if (key === 'sales') {
        result.data = normalizeSalesData(result.data) as unknown as Record<string, unknown>[]
        const prevCount = state.salesData.length
        dispatch({ type: 'SET_PARSE_RESULT', payload: result })
        if (prevCount > 0) {
          dispatch({ type: 'APPEND_LOG', payload: `📊 [sales] 기존 ${prevCount.toLocaleString()}행 + 신규 병합 → 날짜별 중복 제거 완료` })
        }
      } else {
        dispatch({ type: 'SET_PARSE_RESULT', payload: result })
      }
      setDone(d => ({ ...d, [key]: true }))
      setFileNames(f => ({ ...f, [key]: file.name }))
    }
    setUploading(u => ({ ...u, [key]: false }))
  }

  function runAnalysis() {
    setAnalyzing(true)
    dispatch({ type: 'APPEND_LOG', payload: '→ 분석 시작...' })
    setTimeout(() => {
      dispatch({ type: 'APPEND_LOG', payload: '→ 분석 완료 🎉 대시보드로 이동합니다.' })
      setAnalyzing(false)
      // 대시보드로 자동 이동
      router.push('/')
    }, 500)
  }

  function reset() {
    dispatch({ type: 'RESET' })
    setFileNames({})
    setDone({})
    FILE_CONFIG.forEach(({ key }) => {
      if (inputRefs.current[key]) inputRefs.current[key]!.value = ''
    })
  }

  const hasAny = state.masterData.length > 0 || state.salesData.length > 0

  // 판매 데이터 날짜 범위 계산
  const salesDates = state.salesData.map(r => r.date).filter(Boolean).sort()
  const salesDateRange = salesDates.length
    ? `${salesDates[0]} ~ ${salesDates[salesDates.length - 1]}`
    : '없음'

  return (
    <div>
      {/* Status KPIs */}
      <div className="krow">
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">🗂️</div></div>
          <div className="kpi-lbl">분석 상태</div>
          <div className="kpi-val" style={{ fontSize: 14, fontWeight: 800, color: hasAny ? 'var(--green)' : 'var(--t3)' }}>
            {analyzing ? '분석 중...' : hasAny ? '완료' : '대기'}
          </div>
          <div className="kpi-foot">파일 업로드 후</div>
        </div>
        <div className="kpi kc-pu">
          <div className="kpi-top"><div className="kpi-ico">🏷️</div></div>
          <div className="kpi-lbl">상품 수</div>
          <div className="kpi-val">{state.masterData.length ? fmt(state.masterData.length) : '—'}</div>
          <div className="kpi-foot">마스터 기준</div>
        </div>
        <div className="kpi kc-gr">
          <div className="kpi-top"><div className="kpi-ico">🛒</div></div>
          <div className="kpi-lbl">판매 행 (누적)</div>
          <div className="kpi-val">{state.salesData.length ? fmt(state.salesData.length) : '—'}</div>
          <div className="kpi-foot" style={{ fontSize: 9 }}>{salesDates.length ? salesDateRange : '로드 건수'}</div>
        </div>
        <div className="kpi kc-am">
          <div className="kpi-top"><div className="kpi-ico">📋</div></div>
          <div className="kpi-lbl">발주 행</div>
          <div className="kpi-val">{state.ordersData.length ? fmt(state.ordersData.length) : '—'}</div>
          <div className="kpi-foot">발주서 기준</div>
        </div>
      </div>

      {/* 누적 안내 배너 */}
      {hasAny && (
        <div className="card" style={{ marginBottom: 12, background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <div className="cb" style={{ padding: '10px 16px' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#1D4ED8', margin: 0 }}>
              📌 누적 저장 모드 — 새 파일 업로드 시 기존 데이터에 <strong>자동 병합</strong>됩니다.
              같은 날짜+상품 데이터는 새 파일로 덮어씁니다. 전체 초기화는 🔄 초기화 버튼을 이용하세요.
            </p>
          </div>
        </div>
      )}

      {/* Upload */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📂</div><div>
            <div className="ch-title">파일 업로드</div>
            <div className="ch-sub">xlsx · xls · csv 지원 — 컬럼명 자동 인식 — EUC-KR 한글 처리</div>
          </div></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-g" onClick={reset}>🔄 초기화</button>
            <button className="btn-p" disabled={!hasAny || analyzing} onClick={runAnalysis}>
              {analyzing ? '분석 중...' : '✨ 분석 시작'}
            </button>
          </div>
        </div>
        <div className="cb">
          <div className="up-grid2">
            {FILE_CONFIG.map(({ key, icon, title, sub }) => (
              <div key={key}
                className={`up-mini${done[key] ? ' done' : ''}`}
                onClick={() => inputRefs.current[key]?.click()}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  ref={el => { inputRefs.current[key] = el }}
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f, key)
                  }}
                />
                <div className="up-mini-ico">
                  {uploading[key] ? <span className="spinner" /> : icon}
                </div>
                <div className="up-mini-body">
                  <div className="up-mini-title">{title}</div>
                  <div className="up-mini-sub">{sub}</div>
                  {fileNames[key] && (
                    <div className="up-mini-fname">✅ {fileNames[key]}</div>
                  )}
                </div>
                <span style={{ color: 'var(--t3)', fontSize: 14 }}>›</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Parse log */}
      {state.parseLog.length > 0 && (
        <div className="card">
          <div className="ch"><div className="ch-l"><div className="ch-ico">🔍</div><div className="ch-title">파싱 로그</div></div></div>
          <div className="cb" style={{ padding: '10px 14px' }}>
            <div className="log-box">
              {state.parseLog.map((line, i) => (
                <div key={i} className={line.startsWith('✅') ? 'log-ok' : line.startsWith('❌') ? 'log-err' : 'log-info'}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 파일 포맷 가이드 */}
      <div className="card">
        <div className="ch"><div className="ch-l"><div className="ch-ico">📖</div><div className="ch-title">파일 컬럼 가이드</div></div></div>
        <div className="cb">
          <div className="tw">
            <table>
              <thead><tr><th>파일</th><th>필수 컬럼 (자동 인식)</th><th>형식</th></tr></thead>
              <tbody>
                <tr><td style={{ fontWeight: 700 }}>이지어드민 상품마스터</td><td style={{ color: 'var(--t2)' }}>상품명, 옵션, 재고/재고수량</td><td><span className="badge b-bl">xlsx / csv</span></td></tr>
                <tr><td style={{ fontWeight: 700 }}>쿠팡 판매 데이터</td><td style={{ color: 'var(--t2)' }}>상품명, 수량/판매수량, 금액/결제금액, 날짜/주문일</td><td><span className="badge b-bl">xlsx / csv</span></td></tr>
                <tr><td style={{ fontWeight: 700 }}>쿠팡 발주서</td><td style={{ color: 'var(--t2)' }}>상품명, 수량</td><td><span className="badge b-bl">xlsx / csv</span></td></tr>
                <tr><td style={{ fontWeight: 700 }}>공급 중 수량</td><td style={{ color: 'var(--t2)' }}>상품명, 수량/공급수량, 입고예정일 (선택)</td><td><span className="badge b-bl">xlsx / csv</span></td></tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', marginTop: 12 }}>
            💡 컬럼명이 정확히 일치하지 않아도 됩니다. 유사한 단어가 포함되면 자동 감지됩니다.
            한글 EUC-KR 인코딩 Excel 파일도 자동 처리됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}

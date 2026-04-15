'use client'

import { useRef, useState } from 'react'
import { useApp } from '@/lib/store'
import { persistData } from '@/lib/storage'
import { parseFile, normalizeSalesData } from '@/lib/fileParser'
import type { ParseResult, SalesRow } from '@/types'

const FILE_CONFIG = [
  { key: 'master' as const, icon: '📋', title: '이지어드민 상품마스터', sub: '상품코드 · 상품명 · 옵션 · 재고' },
  { key: 'sales'  as const, icon: '🛒', title: '쿠팡 판매 데이터',      sub: '판매량 · 금액 · 날짜' },
  { key: 'orders' as const, icon: '📦', title: '쿠팡 발주서',           sub: '발주번호 · 수량' },
  { key: 'supply' as const, icon: '🚚', title: '공급 중 수량',          sub: '입고 대기 수량 · 예정일' },
]

// Supabase upsert 함수 (anon key 사용)
const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function upsertDailySales(rows: SalesRow[]) {
  if (!rows.length) return 0

  // SalesRow.option에 barcode가 들어있음 (fileParser.ts 참고)
  const data = rows.map(r => ({
    date:        r.date,
    barcode:     (r.option && r.option.length > 3) ? r.option : r.productName,
    quantity:    r.qty,
    revenue:     r.revenue,
    fc_quantity: r.qty,
    vf_quantity: 0,
    stock:       r.stock ?? 0,  // 현재재고수량
  })).filter(r => r.date && r.date.match(/^\d{4}-\d{2}-\d{2}$/) && r.barcode)

  if (!data.length) {
    console.warn('[upsert] 유효한 데이터 없음. rows샘플:', JSON.stringify(rows.slice(0,2)))
    return 0
  }

  // 날짜 분포 확인
  const dates = [...new Set(data.map(r=>r.date))].sort()
  console.log('[upsert] 날짜 분포:', dates, '총', data.length, '행')

  // daily_sales 테이블에 upsert (date + barcode 기준 conflict)
  let total = 0
  for (let i = 0; i < data.length; i += 500) {
    const res = await fetch(`${SUPA_URL}/rest/v1/daily_sales?on_conflict=date,barcode`, {
      method: 'POST',
      headers: {
        'apikey':        SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(data.slice(i, i + 500)),
    })
    if (res.ok) total += Math.min(500, data.length - i)
    else {
      const err = await res.text().catch(()=>'')
      console.warn('[upsert] daily_sales error:', res.status, err.substring(0,300))
    }
  }
  return total
}

export default function DataManagePage() {
  const { state, dispatch } = useApp()
  const [uploading, setUploading] = useState<Record<string,boolean>>({})
  const [fileNames, setFileNames] = useState<Record<string,string>>({})
  const [done, setDone]           = useState<Record<string,boolean>>({})
  const [analyzing, setAnalyzing] = useState(false)
  const inputRefs = useRef<Record<string, HTMLInputElement|null>>({})

  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  async function handleFile(file: File, key: ParseResult['key']) {
    setUploading(u => ({ ...u, [key]: true }))
    const result = await parseFile(file, key)

    if (result.error) {
      dispatch({ type: 'APPEND_LOG', payload: `❌ [${key}] ${result.error}` })
    } else {
      const cols = result.columns.slice(0,5).join(' · ') + (result.columns.length > 5 ? '…' : '')

      if (key === 'sales') {
        // 디버그: raw 첫 행 컬럼명 확인
        const rawKeys = result.data[0] ? Object.keys(result.data[0]).slice(0,8).join(' | ') : 'empty'
        dispatch({ type: 'APPEND_LOG', payload: `🔍 원본컬럼: ${rawKeys}` })
        
        const normalized = normalizeSalesData(result.data) as unknown as Record<string,unknown>[]
        // 디버그: 파싱 후 첫 행 확인
        if (normalized.length > 0) {
          const s = normalized[0] as Record<string,unknown>
          dispatch({ type: 'APPEND_LOG', payload: `🔍 파싱결과: date=${s.date} barcode=${s.option} qty=${s.qty}` })
        } else {
          dispatch({ type: 'APPEND_LOG', payload: `⚠️ 파싱결과: 0행 (날짜/수량 필터에 걸림)` })
        }
        result.data = normalized
        dispatch({ type: 'APPEND_LOG', payload: `✅ [sales] ${result.rows.toLocaleString()}행 | ${cols}` })

        // Supabase sales_data 테이블에 upsert — MV 자동 갱신을 위해 mv_kpi_daily refresh 필요
        dispatch({ type: 'APPEND_LOG', payload: `📤 Supabase에 업로드 중...` })
        const salesRows = result.data as unknown as SalesRow[]
        const saved = await upsertDailySales(salesRows)
        if (saved > 0) {
          dispatch({ type: 'APPEND_LOG', payload: `✅ ${saved.toLocaleString()}행 Supabase 저장 완료` })
          // MV 갱신 (대시보드 즉시 반영)
          fetch(`${SUPA_URL}/rest/v1/rpc/refresh_analytics_mv`, {
            method: 'POST',
            headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
            body: '{}',
          }).then(() => dispatch({ type: 'APPEND_LOG', payload: `🔄 대시보드 데이터 갱신 완료` }))
            .catch(() => {}) // 실패해도 무시
        } else {
          dispatch({ type: 'APPEND_LOG', payload: `⚠️ Supabase 저장 실패 — 파일 컬럼 확인 필요` })
        }

      } else {
        // master/orders/supply는 기존 방식
        await persistData({
          masterData:  key === 'master' ? result.data : state.masterData as Record<string,unknown>[],
          salesData:   [] as never[],
          salesData24: [] as never[],
          salesData25: [] as never[],
          products:    [] as never[],
          ordersData:  key === 'orders' ? result.data : state.ordersData,
          supplyData:  key === 'supply' ? result.data : state.supplyData,
          stockSummary: { total_stock: 0, stock_value: 0 },
          daily26: [], daily25: [], daily24: [],
          latestSaleDate: '',
          hasData: true,
          dateRangePreset: 'total',
        })
        dispatch({ type: 'APPEND_LOG', payload: `✅ [${key}] ${result.rows.toLocaleString()}행 | ${cols}` })
      }

      setDone(d => ({ ...d, [key]: true }))
      setFileNames(f => ({ ...f, [key]: file.name }))
    }
    setUploading(u => ({ ...u, [key]: false }))
  }

  function runAnalysis() {
    setAnalyzing(true)
    dispatch({ type: 'APPEND_LOG', payload: '→ 분석 완료! 대시보드로 이동합니다.' })
    setTimeout(() => {
      setAnalyzing(false)
      const nav = (window as unknown as Record<string,unknown>).navigateTo as ((p:string)=>void)|undefined
      if (nav) {
        nav('/')
      } else {
        window.location.href = '/'
      }
    }, 600)
  }

  function reset() {
    dispatch({ type: 'RESET' })
    setFileNames({}); setDone({})
    FILE_CONFIG.forEach(({ key }) => { if (inputRefs.current[key]) inputRefs.current[key]!.value = '' })
  }

  const hasAny = Object.keys(done).length > 0

  return (
    <div>
      <div className="krow">
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">🗂️</div></div>
          <div className="kpi-lbl">분석 상태</div>
          <div className="kpi-val" style={{ fontSize:14, fontWeight:800, color: hasAny ? 'var(--green)' : 'var(--t3)' }}>
            {analyzing ? '분석 중...' : hasAny ? '업로드 완료' : '대기'}
          </div>
          <div className="kpi-foot">파일 업로드 후</div>
        </div>
        <div className="kpi kc-pu">
          <div className="kpi-top"><div className="kpi-ico">🏷️</div></div>
          <div className="kpi-lbl">상품 수</div>
          <div className="kpi-val">—</div>
          <div className="kpi-foot">마스터 기준</div>
        </div>
        <div className="kpi kc-gr">
          <div className="kpi-top"><div className="kpi-ico">🛒</div></div>
          <div className="kpi-lbl">업로드 파일</div>
          <div className="kpi-val">{Object.keys(done).length}</div>
          <div className="kpi-foot">개 완료</div>
        </div>
        <div className="kpi kc-am">
          <div className="kpi-top"><div className="kpi-ico">📋</div></div>
          <div className="kpi-lbl">발주 행</div>
          <div className="kpi-val">{state.ordersData.length ? fmt(state.ordersData.length) : '—'}</div>
          <div className="kpi-foot">발주서 기준</div>
        </div>
      </div>

      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📂</div><div>
            <div className="ch-title">파일 업로드</div>
            <div className="ch-sub">xlsx · xls · csv — 컬럼명 자동 인식 — EUC-KR 한글 처리</div>
          </div></div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn-g" onClick={reset}>🔄 초기화</button>
            <button className="btn-p" disabled={!hasAny||analyzing} onClick={runAnalysis}>
              {analyzing ? '분석 중...' : '✨ 분석 시작'}
            </button>
          </div>
        </div>
        <div className="cb">
          <div className="up-grid2">
            {FILE_CONFIG.map(({ key, icon, title, sub }) => (
              <div key={key} className={`up-mini${done[key] ? ' done' : ''}`} onClick={() => inputRefs.current[key]?.click()}>
                <input type="file" accept=".xlsx,.xls,.csv"
                  ref={el => { inputRefs.current[key] = el }}
                  style={{ display:'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f, key) }}
                />
                <div className="up-mini-ico">{uploading[key] ? <span className="spinner"/> : icon}</div>
                <div className="up-mini-body">
                  <div className="up-mini-title">{title}</div>
                  <div className="up-mini-sub">{sub}</div>
                  {fileNames[key] && <div className="up-mini-fname">✅ {fileNames[key]}</div>}
                </div>
                <span style={{ color:'var(--t3)', fontSize:14 }}>›</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {state.parseLog.length > 0 && (
        <div className="card">
          <div className="ch"><div className="ch-l"><div className="ch-ico">🔍</div><div className="ch-title">업로드 로그</div></div></div>
          <div className="cb" style={{ padding:'10px 14px' }}>
            <div className="log-box">
              {state.parseLog.map((line, i) => (
                <div key={i} className={line.startsWith('✅') ? 'log-ok' : line.startsWith('❌') ? 'log-err' : 'log-info'}>{line}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="ch"><div className="ch-l"><div className="ch-ico">📖</div><div className="ch-title">파일 컬럼 가이드</div></div></div>
        <div className="cb">
          <div className="tw"><table>
            <thead><tr><th>파일</th><th>필수 컬럼</th><th>형식</th></tr></thead>
            <tbody>
              <tr><td style={{fontWeight:700}}>이지어드민 상품마스터</td><td style={{color:'var(--t2)'}}>상품명, 옵션, 재고수량</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
              <tr><td style={{fontWeight:700}}>쿠팡 판매 데이터</td><td style={{color:'var(--t2)'}}>상품명, 수량/출고수량, 날짜/출고일, 금액(선택)</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
              <tr><td style={{fontWeight:700}}>쿠팡 발주서</td><td style={{color:'var(--t2)'}}>상품명, 수량</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
              <tr><td style={{fontWeight:700}}>공급 중 수량</td><td style={{color:'var(--t2)'}}>상품명, 수량, 입고예정일(선택)</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
            </tbody>
          </table></div>
          <p style={{fontSize:11,color:'var(--t3)',marginTop:12}}>💡 컬럼명 자동 감지. EUC-KR 엑셀 자동 처리.</p>
        </div>
      </div>
    </div>
  )
}
// This line intentionally left blank

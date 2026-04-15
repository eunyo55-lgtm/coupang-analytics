'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/lib/store'
import { persistData } from '@/lib/storage'
import { parseFile, normalizeSalesData } from '@/lib/fileParser'
import { upsertDailySales } from '@/lib/upsertSales'
import type { DailySalesRow } from '@/lib/upsertSales'
import { getPresetRange } from '@/lib/dateUtils'
import type { ParseResult, SalesRow } from '@/types'

const FILE_CONFIG = [
  { key: 'master' as const, icon: '📋', title: '이지어드민 상품마스터', sub: '상품코드 · 상품명 · 옵션 · 재고' },
  { key: 'sales' as const, icon: '🛒', title: '쿠팡 판매 데이터', sub: '판매량 · 금액 · 날짜' },
  { key: 'orders' as const, icon: '📦', title: '쿠팡 발주서', sub: '발주번호 · 수량' },
  { key: 'supply' as const, icon: '🚚', title: '공급 중 수량', sub: '입고 대기 수량 · 예정일' },
]

function mergeSales(prev: SalesRow[], next: SalesRow[]): SalesRow[] {
  if (!prev.length) return next
  const m = new Map<string, SalesRow>()
  prev.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  next.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  return Array.from(m.values()).sort((a,b) => a.date.localeCompare(b.date))
}

function mergeRaw(prev: Record<string,unknown>[], next: Record<string,unknown>[]): Record<string,unknown>[] {
  if (!prev.length) return next
  const k = (r: Record<string,unknown>) => `${r['상품명']||r['productName']||r['item']||''}|${r['옵션']||r['option']||''}`
  const m = new Map<string,Record<string,unknown>>()
  prev.forEach(r => m.set(k(r),r)); next.forEach(r => m.set(k(r),r))
  return Array.from(m.values())
}

export default function DataManagePage() {
  const { state, dispatch } = useApp()
  const router = useRouter()
  const [uploading, setUploading] = useState<Record<string,boolean>>({})
  const [fileNames, setFileNames] = useState<Record<string,string>>({})
  const [done, setDone] = useState<Record<string,boolean>>({})
  const [analyzing, setAnalyzing] = useState(false)
  const inputRefs = useRef<Record<string, HTMLInputElement|null>>({})
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  async function handleFile(file: File, key: ParseResult['key']) {
    setUploading(u => ({ ...u, [key]: true }))
    const result = await parseFile(file, key)
    if (result.error) {
      dispatch({ type: 'APPEND_LOG', payload: `❌ [${key}] ${result.error}` })
    } else {
      if (key === 'sales') {
        const normalized = normalizeSalesData(result.data)
        result.data = normalized as unknown as Record<string,unknown>[]
        const aggMap = new Map<string, DailySalesRow>()
        normalized
          .filter(r => !r.isReturn)
          .forEach(r => {
            const k = `${r.date}|${r.option}`
            const stock = (r as SalesRow & { stock: number }).stock || 0
            if (!aggMap.has(k)) {
              aggMap.set(k, { date: r.date, barcode: r.option, quantity: r.qty, stock, cost: 0 })
            } else {
              const e = aggMap.get(k)!
              e.quantity += r.qty
              e.stock += stock
            }
          })
        const upsertRows: DailySalesRow[] = Array.from(aggMap.values())
        if (upsertRows.length > 0) {
          const upsertResult = await upsertDailySales(upsertRows)
          if (upsertResult.error) {
            dispatch({ type: 'APPEND_LOG', payload: `⚠️ Supabase 저장 실패: ${upsertResult.error}` })
          } else {
            dispatch({ type: 'APPEND_LOG', payload: `✅ Supabase 저장 완료: ${upsertRows.length}건` })
          }
        }
        dispatch({ type: 'HYDRATE', payload: {
          salesData: mergeSales(state.salesData, normalized),
          hasData: true,
        }})
      } else if (key === 'master') {
        dispatch({ type: 'HYDRATE', payload: { masterData: mergeRaw(state.masterData, result.data), hasData: true } })
      } else if (key === 'orders') {
        dispatch({ type: 'HYDRATE', payload: { ordersData: mergeRaw(state.ordersData, result.data), hasData: true } })
      } else if (key === 'supply') {
        dispatch({ type: 'HYDRATE', payload: { supplyData: mergeRaw(state.supplyData, result.data), hasData: true } })
      }
      dispatch({ type: 'APPEND_LOG', payload: `✅ [${key}] ${result.data.length}행 로드` })
      setFileNames(f => ({ ...f, [key]: file.name }))
      setDone(d => ({ ...d, [key]: true }))
    }
    setUploading(u => ({ ...u, [key]: false }))
  }

  function reset() {
    dispatch({ type: 'RESET' })
    setFileNames({})
    setDone({})
  }

  async function runAnalysis() {
    setAnalyzing(true)
    dispatch({ type: 'SET_ANALYZING', payload: true })
    try {
      await persistData({
        salesData: state.salesData,
        salesData24: [] as never[],
        salesData25: [] as never[],
        masterData: state.masterData,
        products: [] as never[],
        ordersData: state.ordersData,
        supplyData: state.supplyData,
        hasData: true,
        dateRangePreset: 'yesterday',
        stockSummary: state.stockSummary,
        daily26: state.daily26,
        daily25: state.daily25,
        daily24: state.daily24,
        latestSaleDate: state.latestSaleDate,
      })
      dispatch({ type: 'HYDRATE', payload: { hasData: true, dateRange: getPresetRange('yesterday', new Date()) } })
      dispatch({ type: 'APPEND_LOG', payload: '✅ 분석 완료! 대시보드로 이동합니다.' })
      router.push('/')
    } catch (e) {
      dispatch({ type: 'APPEND_LOG', payload: `❌ 분석 실패: ${e}` })
    }
    setAnalyzing(false)
    dispatch({ type: 'SET_ANALYZING', payload: false })
  }

  const hasAny = state.masterData.length > 0 || state.salesData.length > 0
  const salesDates = state.salesData.map(r=>r.date).filter(Boolean).sort()

  return (
    <div>
      <div className="krow">
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">🗂️</div></div>
          <div className="kpi-lbl">분석 상태</div>
          <div className="kpi-val" style={{ fontSize:14, fontWeight:800, color: hasAny ? 'var(--green)' : 'var(--t3)' }}>
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
          <div className="kpi-foot" style={{ fontSize:9 }}>
            {salesDates.length ? salesDates[0]+' ~ '+salesDates[salesDates.length-1] : '로드 건수'}
          </div>
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
          <div className="ch"><div className="ch-l"><div className="ch-ico">🔍</div><div className="ch-title">파싱 로그</div></div></div>
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
              <tr><td style={{fontWeight:700}}>쿠팡 판매 데이터</td><td style={{color:'var(--t2)'}}>바코드, 출고수량, 날짜</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
              <tr><td style={{fontWeight:700}}>쿠팡 발주서</td><td style={{color:'var(--t2)'}}>상품명, 수량</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
              <tr><td style={{fontWeight:700}}>공급 중 수량</td><td style={{color:'var(--t2)'}}>상품명, 수량, 입고예정일(선택)</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
            </tbody>
          </table></div>
          <p style={{fontSize:11,color:'var(--t3)',marginTop:12}}>💡 컬럼명이 정확히 일치하지 않아도 됩니다. 유사한 단어 포함 시 자동 감지. EUC-KR 엑셀도 자동 처리.</p>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useRef, useState } from 'react'
import { useApp } from '@/lib/store'
import { persistData } from '@/lib/storage'
import { parseFile, normalizeSalesData } from '@/lib/fileParser'
import type { ParseResult, SalesRow } from '@/types'

const FILE_CONFIG = [
  { key: 'master' as const, icon: '📋', title: '이지어드민 상품마스터',         sub: '상품코드 · 상품명 · 옵션 · 재고' },
  { key: 'sales'  as const, icon: '🛒', title: '쿠팡 판매 데이터',              sub: '판매량 · 금액 · 날짜' },
  { key: 'supply' as const, icon: '🚚', title: '쿠팡 발주서 / 공급 중 수량',    sub: '발주번호 · 입고예정일 · 수량 · 매입가' },
]

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ── 판매 데이터 upsert ──
async function upsertDailySales(rows: SalesRow[], dispatchFn: (a: {type: string; payload: string}) => void) {
  if (!rows.length) return 0

  const data = rows.map(r => ({
    date:        r.date,
    barcode:     (r.option && r.option.length > 3) ? r.option : r.productName,
    quantity:    r.qty,
    stock:       r.stock ?? 0,
    fc_quantity: 0,
    vf_quantity: 0,
  })).filter(r => r.date && r.date.match(/^\d{4}-\d{2}-\d{2}$/) && r.barcode)

  if (!data.length) return 0

  let total = 0
  for (let i = 0; i < data.length; i += 500) {
    const batch = data.slice(i, i + 500)
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/upsert_daily_sales`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: batch }),
    })
    if (res.ok) {
      const cnt = await res.json().catch(() => batch.length)
      total += Number(cnt) || batch.length
    } else {
      const err = await res.text().catch(() => 'unknown error')
      dispatchFn({ type: 'APPEND_LOG', payload: `❌ 저장 에러 (${res.status}): ${err.substring(0,100)}` })
      break
    }
  }
  return total
}

// ── 공급 중 수량 → supply_status upsert ──
async function upsertSupplyStatus(
  rows: Record<string, unknown>[],
  dispatchFn: (a: {type: string; payload: string}) => void
) {
  if (!rows.length) return 0

  const toN = (v: unknown) => Number(String(v ?? '').replace(/[,\s]/g, '')) || 0
  const toS = (v: unknown) => v != null ? String(v).trim() : ''
  const toD = (v: unknown) => {
    const s = toS(v)
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, '-')
    if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
    return s.slice(0, 10)
  }

  const mapped = rows.map(r => ({
    '발주번호':     toN(r['발주번호']),
    'SKU ID':       toN(r['SKU ID']),
    'SKU 이름':     toS(r['SKU 이름']),
    'SKU Barcode':  toS(r['SKU Barcode']),
    '물류센터':     toS(r['물류센터']),
    '입고예정일':   toD(r['입고예정일']),
    '발주일':       toS(r['발주일']),
    '발주수량':     toN(r['발주수량']),
    '확정수량':     toN(r['확정수량']),
    '입고수량':     toN(r['입고수량']),
    '발주유형':     toS(r['발주유형']),
    '발주현황':     toS(r['발주현황']),
    '매입유형':     toS(r['매입유형']),
    '면세여부':     toS(r['면세여부']),
    '생산연도':     toS(r['생산연도']),
    '제조일자':     toS(r['제조일자']),
    '유통기한':     toS(r['유통(소비)기한'] ?? r['유통기한'] ?? ''),
    '매입가':       toN(r['매입가']),
    '공급가':       toN(r['공급가']),
    '부가세':       toN(r['부가세']),
    '총발주매입금': toN(r['총발주 매입금'] ?? r['총발주매입금'] ?? 0),
    '입고금액':     toN(r['입고금액']),
    'xdock':        toS(r['Xdock'] ?? r['xdock'] ?? ''),
  })).filter(r => r['SKU Barcode'] && r['입고예정일'])

  if (!mapped.length) {
    dispatchFn({ type: 'APPEND_LOG', payload: `⚠️ 유효한 supply 데이터 없음 (SKU Barcode, 입고예정일 필수)` })
    return 0
  }

  // 파일 내 중복 제거 — 발주번호+SKU Barcode 기준 마지막 값 유지
  const dedupMap = new Map<string, typeof mapped[0]>()
  for (const row of mapped) {
    const key = `${row['발주번호']}||${row['SKU Barcode']}`
    dedupMap.set(key, row)
  }
  const deduped = Array.from(dedupMap.values())
  const dupCount = mapped.length - deduped.length
  if (dupCount > 0) {
    dispatchFn({ type: 'APPEND_LOG', payload: `🔧 파일 내 중복 ${dupCount}건 제거 → ${deduped.length}건 업로드` })
  }

  // 첫 행 확인 로그
  const sample = deduped[0]
  dispatchFn({ type: 'APPEND_LOG', payload: `🔍 supply 샘플: ${sample['SKU Barcode']} | 예정일:${sample['입고예정일']} | 확정:${sample['확정수량']} | 매입가:${sample['매입가']}` })

  const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' }

  // 발주번호 + SKU Barcode unique constraint 기준으로 중복 시 업데이트, 신규는 추가
  let total = 0
  for (let i = 0; i < deduped.length; i += 500) {
    const batch = deduped.slice(i, i + 500)
    const res = await fetch(`${SUPA_URL}/rest/v1/supply_status`, {
      method: 'POST',
      headers: {
        ...h,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    })
    if (res.ok || res.status === 201) {
      total += batch.length
      if (i % 1000 === 0 || i + 500 >= deduped.length) {
        dispatchFn({ type: 'APPEND_LOG', payload: `📤 ${Math.min(total, deduped.length)}/${deduped.length}행 처리 중...` })
      }
    } else {
      const err = await res.text().catch(() => 'unknown')
      dispatchFn({ type: 'APPEND_LOG', payload: `❌ supply 저장 에러 (${res.status}): ${err.substring(0,150)}` })
      break
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
        const rawKeys = result.data[0] ? Object.keys(result.data[0]).slice(0,8).join(' | ') : 'empty'
        dispatch({ type: 'APPEND_LOG', payload: `🔍 원본컬럼: ${rawKeys}` })
        const normalized = normalizeSalesData(result.data) as unknown as Record<string,unknown>[]
        if (normalized.length > 0) {
          const s = normalized[0] as Record<string,unknown>
          dispatch({ type: 'APPEND_LOG', payload: `🔍 파싱결과: date=${s.date} barcode=${s.option} qty=${s.qty}` })
        } else {
          dispatch({ type: 'APPEND_LOG', payload: `⚠️ 파싱결과: 0행 (날짜/수량 필터에 걸림)` })
        }
        result.data = normalized
        dispatch({ type: 'APPEND_LOG', payload: `✅ [sales] ${result.rows.toLocaleString()}행 | ${cols}` })
        dispatch({ type: 'APPEND_LOG', payload: `📤 Supabase에 업로드 중...` })
        const salesRows = result.data as unknown as SalesRow[]
        const saved = await upsertDailySales(salesRows, dispatch)
        if (saved > 0) {
          dispatch({ type: 'APPEND_LOG', payload: `✅ ${saved.toLocaleString()}행 Supabase 저장 완료` })
          fetch(`${SUPA_URL}/rest/v1/rpc/refresh_analytics_mv`, {
            method: 'POST',
            headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
            body: '{}',
          }).then(() => dispatch({ type: 'APPEND_LOG', payload: `🔄 대시보드 데이터 갱신 완료` }))
            .catch(() => {})
        } else {
          dispatch({ type: 'APPEND_LOG', payload: `⚠️ Supabase 저장 실패 — 위 에러 메시지 확인` })
        }

      } else if (key === 'supply') {
        dispatch({ type: 'APPEND_LOG', payload: `✅ [supply] ${result.rows.toLocaleString()}행 | ${cols}` })
        dispatch({ type: 'APPEND_LOG', payload: `📤 supply_status 테이블에 업로드 중...` })
        const saved = await upsertSupplyStatus(result.data, dispatch)
        if (saved > 0) {
          dispatch({ type: 'APPEND_LOG', payload: `✅ ${saved.toLocaleString()}행 supply_status 저장 완료` })
        } else {
          dispatch({ type: 'APPEND_LOG', payload: `⚠️ supply_status 저장 실패 — 로그 확인` })
        }
        // store에도 보관
        await persistData({
          masterData:   state.masterData as Record<string,unknown>[],
          salesData:    [] as never[], salesData24: [] as never[], salesData25: [] as never[],
          products:     [] as never[],
          ordersData:   state.ordersData,
          supplyData:   result.data,
          stockSummary: { total_stock: 0, stock_value: 0 },
          daily26: [], daily25: [], daily24: [],
          latestSaleDate: '', hasData: true, dateRangePreset: 'total',
        })

      } else {
        await persistData({
          masterData:  key === 'master' ? result.data : state.masterData as Record<string,unknown>[],
          salesData:   [] as never[], salesData24: [] as never[], salesData25: [] as never[],
          products:    [] as never[],
          ordersData:  key === 'orders' ? result.data : state.ordersData,
          supplyData:  state.supplyData,
          stockSummary: { total_stock: 0, stock_value: 0 },
          daily26: [], daily25: [], daily24: [],
          latestSaleDate: '', hasData: true, dateRangePreset: 'total',
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
      if (nav) { nav('/') } else { window.location.href = '/' }
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
          <div className="up-grid1" style={{ display:'flex', flexDirection:'column', gap:8 }}>
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
              <tr><td style={{fontWeight:700}}>쿠팡 판매 데이터</td><td style={{color:'var(--t2)'}}>상품명, 수량/출고수량, 날짜/출고일</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
              <tr><td style={{fontWeight:700}}>쿠팡 발주서 / 공급 중 수량</td><td style={{color:'var(--t2)'}}>SKU Barcode · 입고예정일 · 발주수량 · 확정수량 · 입고수량 · 매입가</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
            </tbody>
          </table></div>
          <p style={{fontSize:11,color:'var(--t3)',marginTop:12}}>💡 쿠팡 발주서 = 공급 중 수량 파일은 동일해요. 발주번호+바코드 기준으로 중복 자동 처리되므로 매일 누적 업로드 가능합니다.</p>
        </div>
      </div>
    </div>
  )
}

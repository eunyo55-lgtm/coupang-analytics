'use client'

import { useRef, useState } from 'react'
import { useApp } from '@/lib/store'
import { persistData } from '@/lib/storage'
import { parseFile, normalizeSalesData, normalizeWideSalesData, isWideSalesFormat, extractYearFromFilename, detectColumn, toNumber } from '@/lib/fileParser'
import type { ParseResult, SalesRow } from '@/types'

const FILE_CONFIG = [
  { key: 'master' as const, icon: '📋', title: '이지어드민 상품마스터',         sub: '상품코드 · 상품명 · 옵션 · 재고 · 시즌 · 이미지' },
  { key: 'sales'  as const, icon: '🛒', title: '쿠팡 판매 데이터',              sub: '판매량 · 금액 · 날짜' },
  { key: 'supply' as const, icon: '🚚', title: '쿠팡 발주서 / 공급 중 수량',    sub: '발주번호 · 입고예정일 · 수량 · 매입가' },
]

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ── dispatch 타입 (Dispatch<Action>을 직접 받도록 넓힘) ──
type LogDispatch = (a: { type: 'APPEND_LOG'; payload: string }) => void

// ── 판매 데이터 upsert ──
async function upsertDailySales(rows: SalesRow[], dispatchFn: LogDispatch) {
  if (!rows.length) return 0

  const data = rows.map(r => ({
    date:         r.date,
    barcode:      (r.option && r.option.length > 3) ? r.option : r.productName,
    quantity:     r.qty,
    stock:        r.stock ?? 0,
    coupang_cost: r.coupangCost ?? 0,  // 쿠팡 허브 파일의 매입원가
    fc_quantity:  0,
    vf_quantity:  0,
  })).filter(r => r.date && r.date.match(/^\d{4}-\d{2}-\d{2}$/) && r.barcode)

  if (!data.length) return 0

  // batch 사이즈 200 — 500은 daily_sales가 638k+ 행일 때 statement timeout(57014)을 일으킴.
  // timeout 발생 시 자동 재시도(최대 3회): 일시적 부하라면 회복됨.
  const BATCH = 200
  const total_batches = Math.ceil(data.length / BATCH)
  let total = 0
  let batchNum = 0

  for (let i = 0; i < data.length; i += BATCH) {
    batchNum++
    const batch = data.slice(i, i + BATCH)
    let attempts = 0
    let ok = false

    while (attempts < 3 && !ok) {
      attempts++
      const res = await fetch(`${SUPA_URL}/rest/v1/rpc/upsert_daily_sales`, {
        method: 'POST',
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: batch }),
      })
      if (res.ok) {
        const cnt = await res.json().catch(() => batch.length)
        total += Number(cnt) || batch.length
        ok = true
      } else {
        const err = await res.text().catch(() => 'unknown error')
        if (res.status === 500 && attempts < 3) {
          dispatchFn({ type: 'APPEND_LOG', payload: `⏳ batch ${batchNum}/${total_batches} timeout — 재시도 ${attempts}/3` })
          await new Promise(r => setTimeout(r, 800 * attempts)) // back-off
        } else {
          dispatchFn({ type: 'APPEND_LOG', payload: `❌ 저장 에러 (${res.status}, batch ${batchNum}/${total_batches}): ${err.substring(0,100)}` })
          return total // 다음 batch로 진행 안 하고 종료, 이미 처리된 양만 반환
        }
      }
    }
    if (!ok) {
      dispatchFn({ type: 'APPEND_LOG', payload: `⛔ batch ${batchNum}/${total_batches} 3회 시도 실패 — 중단` })
      return total
    }
    // 진행 표시 (10 batch마다)
    if (batchNum % 10 === 0 || batchNum === total_batches) {
      dispatchFn({ type: 'APPEND_LOG', payload: `📤 ${total.toLocaleString()}/${data.length.toLocaleString()}행 저장 중... (batch ${batchNum}/${total_batches})` })
    }
  }
  return total
}

// ── 이지어드민 상품마스터 → products 테이블 upsert ──
// 컬럼 매칭:
//  barcode      ← 바코드/상품코드
//  name         ← 상품명
//  option_value ← 옵션
//  cost         ← 원가
//  season       ← 시즌
//  image_url    ← 이미지(URL)
//  category     ← 카테고리/분류
async function upsertProducts(
  rows: Record<string, unknown>[],
  dispatchFn: LogDispatch
) {
  if (!rows.length) return 0

  const s0 = rows[0] as Record<string, unknown>
  const bcCol    = detectColumn(s0, ['바코드', 'barcode', 'SKU Barcode', '상품바코드'])
  const nameCol  = detectColumn(s0, ['상품명', 'productname', '상품이름', 'item', '노출상품명', 'SKU 명', 'SKU명'])
  const optCol   = detectColumn(s0, ['옵션', 'option', '옵션명', '옵션값', '속성'])
  const costCol  = detectColumn(s0, ['원가', '매입원가', 'cost', '매입가', '공급가'])
  const seasonCol   = detectColumn(s0, ['시즌', 'season', '시즌구분'])
  const imageCol    = detectColumn(s0, ['이미지', 'image', '이미지URL', '이미지주소', 'image_url', '대표이미지'])
  const categoryCol = detectColumn(s0, ['카테고리', 'category', '분류', '상품분류', '대분류', '품목'])
  const hqStockCol  = detectColumn(s0, ['가용재고', '본사재고', 'hq_stock', '가용수량', '현재고', '재고수량'])

  if (!bcCol && !nameCol) {
    dispatchFn({ type: 'APPEND_LOG', payload: `⚠️ 바코드/상품명 컬럼을 찾지 못해 products 저장 스킵` })
    return 0
  }

  dispatchFn({
    type: 'APPEND_LOG',
    payload: `🔍 master 컬럼 매핑: 바코드=${bcCol} | 상품명=${nameCol} | 옵션=${optCol} | 원가=${costCol} | 시즌=${seasonCol} | 이미지=${imageCol} | 카테고리=${categoryCol} | 가용재고=${hqStockCol}`
  })

  const toStr = (v: unknown) => v != null ? String(v).trim() : ''
  const mapped = rows.map(r => ({
    barcode:      bcCol    ? toStr(r[bcCol])    : '',
    name:         nameCol  ? toStr(r[nameCol])  : '',
    option_value: optCol   ? toStr(r[optCol])   : '',
    cost:         costCol  ? toNumber(r[costCol]) : 0,
    season:       seasonCol   ? toStr(r[seasonCol])   : '',
    image_url:    imageCol    ? toStr(r[imageCol])    : '',
    category:     categoryCol ? toStr(r[categoryCol]) : '',
    hq_stock:     hqStockCol  ? toNumber(r[hqStockCol]) : 0,
  })).filter(r => r.barcode)

  if (!mapped.length) {
    dispatchFn({ type: 'APPEND_LOG', payload: `⚠️ 바코드 있는 행이 없어 products 저장 스킵` })
    return 0
  }

  // 중복 제거 — barcode 기준 마지막 값 유지
  const dedupMap = new Map<string, typeof mapped[0]>()
  for (const row of mapped) dedupMap.set(row.barcode, row)
  const deduped = Array.from(dedupMap.values())

  let total = 0
  for (let i = 0; i < deduped.length; i += 500) {
    const batch = deduped.slice(i, i + 500)
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/upsert_products`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: batch }),
    })
    if (res.ok) {
      const cnt = await res.json().catch(() => batch.length)
      total += Number(cnt) || batch.length
    } else {
      const err = await res.text().catch(() => 'unknown')
      dispatchFn({ type: 'APPEND_LOG', payload: `❌ products 저장 에러 (${res.status}): ${err.substring(0,150)}` })
      break
    }
  }
  return total
}

// ── 공급 중 수량 → supply_status upsert ──
async function upsertSupplyStatus(
  rows: Record<string, unknown>[],
  dispatchFn: LogDispatch
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

  // upsert_supply_status RPC 사용 — ON CONFLICT ("발주번호","SKU Barcode") DO UPDATE
  let total = 0
  for (let i = 0; i < deduped.length; i += 500) {
    const batch = deduped.slice(i, i + 500)
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/upsert_supply_status`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: batch }),
    })
    if (res.ok) {
      const cnt = await res.json().catch(() => batch.length)
      total += Number(cnt) || batch.length
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

        // wide format(피벗 — 1행=1바코드, 365개 날짜 컬럼) 자동 감지 및 분기
        let normalized: Record<string,unknown>[]
        if (isWideSalesFormat(result.data[0])) {
          const year = extractYearFromFilename(file.name)
          if (!year) {
            dispatch({ type: 'APPEND_LOG', payload: `❌ wide-format 인식되었으나 파일명에서 연도(예: 2024, 25년)를 못 찾음 — 파일명 변경 후 재업로드 필요` })
            setUploading(u => ({ ...u, [key]: false }))
            return
          }
          dispatch({ type: 'APPEND_LOG', payload: `📅 wide-format 인식: ${year}년 데이터로 변환 중` })
          normalized = normalizeWideSalesData(result.data, year) as unknown as Record<string,unknown>[]
          dispatch({ type: 'APPEND_LOG', payload: `↻ ${result.data.length.toLocaleString()}행 × 날짜컬럼 → ${normalized.length.toLocaleString()}행 (qty>0만)` })
        } else {
          normalized = normalizeSalesData(result.data) as unknown as Record<string,unknown>[]
        }

        if (normalized.length > 0) {
          const s = normalized[0] as Record<string,unknown>
          dispatch({ type: 'APPEND_LOG', payload: `🔍 파싱결과: date=${s.date} barcode=${s.option} qty=${s.qty}` })
        } else {
          dispatch({ type: 'APPEND_LOG', payload: `⚠️ 파싱결과: 0행 (날짜/수량 필터에 걸림)` })
        }
        result.data = normalized
        dispatch({ type: 'APPEND_LOG', payload: `✅ [sales] ${normalized.length.toLocaleString()}행 변환 완료 | ${cols}` })
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

      } else if (key === 'master') {
        // 이지어드민 상품마스터: products 테이블에 시즌/이미지/카테고리까지 영구 저장
        dispatch({ type: 'APPEND_LOG', payload: `✅ [master] ${result.rows.toLocaleString()}행 | ${cols}` })
        dispatch({ type: 'APPEND_LOG', payload: `📤 products 테이블에 업로드 중...` })
        const saved = await upsertProducts(result.data, dispatch)
        if (saved > 0) {
          dispatch({ type: 'APPEND_LOG', payload: `✅ ${saved.toLocaleString()}행 products 저장 완료 (시즌/이미지 포함)` })
        } else {
          dispatch({ type: 'APPEND_LOG', payload: `⚠️ products 저장 0행 — 위 에러 확인 또는 SQL 마이그레이션(컬럼 추가) 필요` })
        }
        // 로컬 persistData도 유지
        await persistData({
          masterData:  result.data,
          salesData:   [] as never[], salesData24: [] as never[], salesData25: [] as never[],
          products:    [] as never[],
          ordersData:  state.ordersData,
          supplyData:  state.supplyData,
          stockSummary: { total_stock: 0, stock_value: 0 },
          daily26: [], daily25: [], daily24: [],
          latestSaleDate: '', hasData: true, dateRangePreset: 'total',
        })

      } else {
        await persistData({
          masterData:  state.masterData as Record<string,unknown>[],
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
              <tr><td style={{fontWeight:700}}>이지어드민 상품마스터</td><td style={{color:'var(--t2)'}}>바코드, 상품명, 옵션, 원가, 시즌, 이미지(URL), 카테고리</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
              <tr><td style={{fontWeight:700}}>쿠팡 판매 데이터</td><td style={{color:'var(--t2)'}}>상품명, 수량/출고수량, 날짜/출고일</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
              <tr><td style={{fontWeight:700}}>쿠팡 발주서 / 공급 중 수량</td><td style={{color:'var(--t2)'}}>SKU Barcode · 입고예정일 · 발주수량 · 확정수량 · 입고수량 · 매입가</td><td><span className="badge b-bl">xlsx/csv</span></td></tr>
            </tbody>
          </table></div>
          <p style={{fontSize:11,color:'var(--t3)',marginTop:12}}>💡 상품마스터는 시즌/이미지/카테고리까지 products 테이블에 영구 저장됩니다. 한 번 업로드하면 모든 탭에서 사용 가능.</p>
        </div>
      </div>
    </div>
  )
}

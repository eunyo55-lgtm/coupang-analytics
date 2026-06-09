'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceArea } from 'recharts'
import { readSwrCache, writeSwrCache } from '@/lib/swrCache'
import { vatExcluded } from '@/lib/vatUtils'

const SUPPLY_CACHE_TTL_MS = 5 * 60 * 1000

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI'

type SupplyRow = {
  'SKU 이름': string
  'SKU Barcode': string
  물류센터?: string
  입고예정일: string
  발주일?: string
  발주수량: number
  확정수량: number
  입고수량: number
  매입가: number
  발주유형?: string
  발주현황?: string
  발주번호?: string | number
  'SKU ID'?: string | number
  name?: string
  image_url?: string
}

function toD(s: unknown) { return s ? String(s).slice(0, 10) : '' }
function toN(v: unknown) { return Number(v) || 0 }

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const startOfYear = new Date(d.getFullYear(), 0, 1)
  const diff = d.getTime() - startOfYear.getTime()
  const week = Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7)
  return `W${week}`
}

// ── 모듈 레벨 캐시 (탭 이동 시 데이터 유지) + localStorage 백킹 ──
// 모듈 변수는 SPA 내 탭 이동에 빠르지만 새로고침 시 사라짐.
// localStorage(SWR 5분 TTL)로 백킹해 새로고침에서도 즉시 표시.
// v2: VAT 별도 적용으로 캐시 무효화
const SUPPLY_ALL_KEY = 'swr_supply_all_v2'
const SUPPLY_PRODMAP_KEY = 'swr_supply_prodmap_v1'

interface SupplyAllCache {
  allRows: SupplyRow[]
  prodMap: Record<string, { name: string; image_url: string }>
}

function readSupplyCache(): SupplyAllCache | null {
  const r = readSwrCache<SupplyAllCache>(SUPPLY_ALL_KEY, SUPPLY_CACHE_TTL_MS)
  return r ? r.data : null
}

const _initialSupplyCache = typeof window !== 'undefined' ? readSupplyCache() : null
let _cachedAllRows: SupplyRow[] = _initialSupplyCache?.allRows ?? []
let _cachedProdMap: Record<string,{name:string;image_url:string}> = _initialSupplyCache?.prodMap ?? {}
let _cachedRows: Record<string, SupplyRow[]> = {}  // key: `${dateFrom}-${dateTo}` (in-memory only)
let _cacheLoaded = _cachedAllRows.length > 0

function getOneMonthAgo() {
  const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0,10)
}

function getOneMonthLater() {
  const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0,10)
}

// 캐시된 allRows의 가장 먼 미래 날짜를 즉시 계산.
// 캐시 없으면 today+30 — 일반적인 미래 공급 일정 cover.
// 이걸 초기 chartTo/tableTo로 쓰면 첫 fetch가 미래까지 한 번에 처리되어
// "오늘까지 → 미래까지" 2번 fetch 문제 해결.
function getInitialTo(cachedAllRows: SupplyRow[]): string {
  let maxDate = ''
  for (const r of cachedAllRows) {
    const d = toD(r.입고예정일)
    if (d && d > maxDate) maxDate = d
  }
  if (maxDate) return maxDate
  const d = new Date(); d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0,10)
}

export default function SupplyPage() {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const today = new Date().toISOString().slice(0, 10)

  const threeMonthsAgo = getOneMonthAgo()  // 기본값을 1달로

  const [rows, setRows] = useState<SupplyRow[]>(_cachedAllRows.length ? _cachedRows[`${getOneMonthAgo()}-${getOneMonthLater()}`] || [] : [])
  const [allRows, setAllRows] = useState<SupplyRow[]>(_cachedAllRows)
  const [prevYearRows, setPrevYearRows] = useState<SupplyRow[]>([])
  const [prodMap, setProdMap] = useState<Record<string,{name:string;image_url:string}>>(_cachedProdMap)
  const [loading, setLoading] = useState(!_cacheLoaded)

  // 차트/테이블 날짜 필터 — 기본: 1달 전 ~ (캐시된 max future or today+30)
  // 초기값이 미래까지 cover하므로 첫 fetch에서 모든 데이터를 한 번에 받음.
  const [chartFrom, setChartFrom] = useState(() => getOneMonthAgo())
  const [chartTo,   setChartTo]   = useState(() => getInitialTo(_cachedAllRows))
  const [tableFrom, setTableFrom] = useState(() => getOneMonthAgo())
  const [tableTo,   setTableTo]   = useState(() => getInitialTo(_cachedAllRows))
  // DB 로드용 = 두 필터의 min/max
  const dateFrom = useMemo(() => chartFrom < tableFrom ? chartFrom : tableFrom, [chartFrom, tableFrom])
  const dateTo   = useMemo(() => chartTo > tableTo ? chartTo : tableTo, [chartTo, tableTo])

  const [search, setSearch] = useState('')
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())

  const weekRange = useMemo(() => {
    const d = new Date(), dow = d.getDay()
    const lastThu = new Date(d); lastThu.setDate(d.getDate() - ((dow + 3) % 7 + 1))
    const lastFri = new Date(lastThu); lastFri.setDate(lastThu.getDate() - 6)
    return { from: lastFri.toISOString().slice(0,10), to: lastThu.toISOString().slice(0,10) }
  }, [])

  // ── 미래 공급 예정 데이터까지 자동 확장 ──
  // allRows의 가장 먼 미래 날짜를 추적. 새 데이터 업로드로 max가 미래로 늘어나면 자동 확장.
  // (한 번만 실행하던 옛 로직은 업로드 후 새 미래 날짜를 못 잡았음)
  const lastSeenMaxRef = useRef<string>('')
  useEffect(() => {
    if (allRows.length === 0) return
    let maxDate = ''
    for (const r of allRows) {
      const d = toD(r.입고예정일)
      if (d && d > maxDate) maxDate = d
    }
    if (!maxDate || maxDate <= lastSeenMaxRef.current) return  // 새로 늘어난 게 아니면 패스
    lastSeenMaxRef.current = maxDate
    if (maxDate > chartTo) setChartTo(maxDate)
    if (maxDate > tableTo) setTableTo(maxDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows])

  // ── 전체 데이터 로드 — stale-while-revalidate ──
  // 캐시 있으면 즉시 표시 + 항상 백그라운드 fresh fetch.
  // (이전엔 _cacheLoaded=true면 fresh fetch 영원히 안 해서 업로드 후 새 데이터 안 보임)
  useEffect(() => {
    async function loadAll() {
      const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
      let all: SupplyRow[] = [], offset = 0
      while (true) {
        const r = await fetch(
          `${SUPA_URL}/rest/v1/supply_status?select=입고예정일,발주수량,확정수량,입고수량,매입가,SKU Barcode&order=입고예정일.asc&limit=1000&offset=${offset}`,
          { headers: h }
        )
        const page: SupplyRow[] = await r.json()
        if (!Array.isArray(page) || page.length === 0) break
        all = all.concat(page.map(r => ({
          ...r,
          'SKU 이름': '', 발주수량: toN(r.발주수량),
          확정수량: toN(r.확정수량), 입고수량: toN(r.입고수량), 매입가: vatExcluded(toN(r.매입가)),
        })))
        if (page.length < 1000) break
        offset += 1000
      }
      _cachedAllRows = all
      setAllRows(all)

      // products 매핑
      const barcodes = [...new Set(all.map(r => r['SKU Barcode']).filter(Boolean))]
      const pm: Record<string,{name:string;image_url:string}> = {}
      for (let i = 0; i < barcodes.length; i += 200) {
        const batch = barcodes.slice(i, i + 200)
        try {
          const pr = await fetch(
            `${SUPA_URL}/rest/v1/products?select=barcode,name,image_url&barcode=in.(${batch.map(b=>`"${b}"`).join(',')})`,
            { headers: h }
          )
          const pdata: {barcode:string;name:string;image_url:string}[] = await pr.json()
          if (Array.isArray(pdata)) pdata.forEach(p => { pm[p.barcode] = { name: p.name, image_url: p.image_url } })
        } catch { /* ignore */ }
      }
      _cachedProdMap = pm
      _cacheLoaded = true
      setProdMap(pm)
      // localStorage 백킹 — 새로고침 후에도 즉시 표시
      writeSwrCache<SupplyAllCache>(SUPPLY_ALL_KEY, { allRows: all, prodMap: pm })
    }
    loadAll()
  }, [])

  // ── 전년도 동일 기간 데이터 (입고액 YoY 비교용) ──
  useEffect(() => {
    if (!chartFrom || !chartTo) return
    const prevFrom = chartFrom.replace(/^\d{4}/, m => String(+m - 1))
    const prevTo   = chartTo.replace(/^\d{4}/, m => String(+m - 1))
    if (!prevFrom || !prevTo) return
    let cancelled = false
    async function loadPrev() {
      const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
      try {
        let all: SupplyRow[] = [], offset = 0
        while (true) {
          const r = await fetch(
            `${SUPA_URL}/rest/v1/supply_status?select=입고예정일,입고수량,매입가,SKU Barcode&입고예정일=gte.${prevFrom}&입고예정일=lte.${prevTo}&order=입고예정일.asc&limit=1000&offset=${offset}`,
            { headers: h }
          )
          if (cancelled) return
          const page: SupplyRow[] = await r.json()
          if (!Array.isArray(page) || page.length === 0) break
          all = all.concat(page.map(r => ({
            ...r,
            'SKU 이름': '', 발주수량: 0, 확정수량: 0,
            입고수량: toN(r.입고수량), 매입가: vatExcluded(toN(r.매입가)),
          })))
          if (page.length < 1000) break
          offset += 1000
        }
        if (!cancelled) setPrevYearRows(all)
      } catch (e) { console.warn('[supply prev year]', e) }
    }
    loadPrev()
    return () => { cancelled = true }
  }, [chartFrom, chartTo])

  // ── 날짜 필터 기간 데이터 로드 — stale-while-revalidate ──
  useEffect(() => {
    const cacheKey = `${dateFrom}-${dateTo}`
    let cancelled = false
    if (_cachedRows[cacheKey]) {
      // 캐시 즉시 표시 (체감 0초) — 그리고 항상 백그라운드 갱신
      setRows(_cachedRows[cacheKey].map(r => ({
        ...r,
        name:      _cachedProdMap[r['SKU Barcode']]?.name || r['SKU 이름'],
        image_url: _cachedProdMap[r['SKU Barcode']]?.image_url || '',
      })))
      setLoading(false)
      // fresh fetch는 그래도 진행 (return 안 함)
    }
    async function load() {
      if (!_cachedRows[cacheKey]) setLoading(true)
      try {
        const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
        const from = dateFrom
        const to   = dateTo

        let allData: SupplyRow[] = [], offset = 0
        while (true) {
          const r = await fetch(
            `${SUPA_URL}/rest/v1/supply_status?select=*&order=입고예정일.asc&입고예정일=gte.${from}&입고예정일=lte.${to}&limit=1000&offset=${offset}`,
            { headers: h }
          )
          const page: SupplyRow[] = await r.json()
          if (!Array.isArray(page) || page.length === 0) break
          allData = allData.concat(page)
          if (page.length < 1000) break
          offset += 1000
        }

        const mapped = allData.map(r => ({
          ...r,
          발주수량: toN(r.발주수량), 확정수량: toN(r.확정수량),
          입고수량: toN(r.입고수량), 매입가: vatExcluded(toN(r.매입가)),
          name:      prodMap[r['SKU Barcode']]?.name || r['SKU 이름'],
          image_url: prodMap[r['SKU Barcode']]?.image_url || '',
        }))
        _cachedRows[cacheKey] = mapped  // 캐시 저장
        if (!cancelled) setRows(mapped)
      } catch (e) { console.warn(e) }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [dateFrom, dateTo, prodMap])

  // 검색어 적용된 rows (차트/테이블용)
  const filtered = useMemo(() => rows.filter(r => {
    return !search || (r.name||r['SKU 이름']).toLowerCase().includes(search.toLowerCase()) || r['SKU Barcode'].includes(search)
  }), [rows, search])

  // 검색어 적용된 allRows (KPI/이동중용) — prodMap으로 단축명 검색 포함
  const filteredAll = useMemo(() => {
    if (!search) return allRows
    const s = search.toLowerCase()
    return allRows.filter(r => {
      const skuName = (r['SKU 이름'] || '').toLowerCase()
      const shortName = (prodMap[r['SKU Barcode']]?.name || '').toLowerCase()
      const barcode = (r['SKU Barcode'] || '').toLowerCase()
      return skuName.includes(s) || shortName.includes(s) || barcode.includes(s)
    })
  }, [allRows, search, prodMap])

  function calcKpi(rowSet: SupplyRow[]) {
    const ord = rowSet.reduce((s,r) => s + toN(r.발주수량), 0)
    const qty = rowSet.reduce((s,r) => s + toN(r.확정수량), 0)
    const rec = rowSet.reduce((s,r) => s + toN(r.입고수량), 0)
    const ordAmt  = rowSet.reduce((s,r) => s + toN(r.발주수량) * toN(r.매입가), 0)
    const confAmt = rowSet.reduce((s,r) => s + toN(r.확정수량) * toN(r.매입가), 0)
    const recAmt  = rowSet.reduce((s,r) => s + toN(r.입고수량) * toN(r.매입가), 0)
    const rate    = ord > 0 ? Math.round(qty / ord * 100) : 0
    return { ord, qty, rec, ordAmt, confAmt, recAmt, rate }
  }

  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1)
  const yesterdayStr = yesterday.toISOString().slice(0,10)

  const kpiYest   = useMemo(() => calcKpi(filteredAll.filter(r => toD(r.입고예정일) === yesterdayStr)), [filteredAll])
  const kpiWeek   = useMemo(() => calcKpi(filteredAll.filter(r => { const d=toD(r.입고예정일); return d>=weekRange.from&&d<=weekRange.to })), [filteredAll, weekRange])
  const kpiCum    = useMemo(() => calcKpi(filteredAll.filter(r => toD(r.입고예정일) >= '2026-01-01')), [filteredAll])
  const kpiMoving = useMemo(() => calcKpi(filteredAll.filter(r => toD(r.입고예정일) >= today && toN(r.입고수량) === 0)), [filteredAll])

  // 차트 — chartFrom~chartTo 필터.
  // 막대는 금액(원) 기준 (qty × 매입가). 공급률은 금액 비율로 계산.
  // 전년 동일 MM-DD 입고금액도 함께 (작년 데이터 없으면 0).
  const chartData = useMemo(() => {
    const byDate: Record<string, { ordAmt: number; qtyAmt: number; recAmt: number }> = {}
    filtered.filter(r => { const d=toD(r.입고예정일); return d>=chartFrom&&d<=chartTo }).forEach(r => {
      const d = toD(r.입고예정일)
      const mp = toN(r.매입가)
      if (!byDate[d]) byDate[d] = { ordAmt: 0, qtyAmt: 0, recAmt: 0 }
      byDate[d].ordAmt += toN(r.발주수량) * mp
      byDate[d].qtyAmt += toN(r.확정수량) * mp
      byDate[d].recAmt += toN(r.입고수량) * mp
    })
    // 전년 입고금액 — MM-DD 기준 매핑
    const prevByMD: Record<string, number> = {}
    prevYearRows.forEach(r => {
      const d = toD(r.입고예정일); if (!d) return
      const md = d.slice(5)
      prevByMD[md] = (prevByMD[md] || 0) + toN(r.입고수량) * toN(r.매입가)
    })
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const md = date.slice(5)
        const confirmRate = v.ordAmt > 0 ? Math.round((v.qtyAmt / v.ordAmt) * 100) : null
        return {
          date: md,
          ordAmt: Math.round(v.ordAmt),
          qtyAmt: Math.round(v.qtyAmt),
          recAmt: Math.round(v.recAmt),
          prevRecAmt: Math.round(prevByMD[md] || 0),
          confirmRate,
        }
      })
  }, [filtered, chartFrom, chartTo, prevYearRows])

  const yearPrev = new Date().getFullYear() - 1

  // 주간 집계 — 일별 데이터를 월요일 시작 주차로 묶음
  const weeklyChartData = useMemo(() => {
    const buckets: Record<string, { ordAmt: number; qtyAmt: number; recAmt: number; weekStart: string }> = {}
    filtered.filter(r => { const d=toD(r.입고예정일); return d>=chartFrom && d<=chartTo }).forEach(r => {
      const d = toD(r.입고예정일)
      if (!d) return
      const [y, m, dd] = d.split('-').map(Number)
      const dt = new Date(y, m - 1, dd)
      const dow = dt.getDay()  // 0=일, 1=월
      const monOffset = dow === 0 ? -6 : 1 - dow
      const mon = new Date(dt); mon.setDate(dt.getDate() + monOffset)
      const wk = `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`
      const mp = toN(r.매입가)
      if (!buckets[wk]) buckets[wk] = { ordAmt: 0, qtyAmt: 0, recAmt: 0, weekStart: wk }
      buckets[wk].ordAmt += toN(r.발주수량) * mp
      buckets[wk].qtyAmt += toN(r.확정수량) * mp
      buckets[wk].recAmt += toN(r.입고수량) * mp
    })
    return Object.values(buckets)
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map(v => {
        const confirmRate = v.ordAmt > 0 ? Math.round((v.qtyAmt / v.ordAmt) * 100) : null
        const fulfillRate = v.qtyAmt > 0 ? Math.round((v.recAmt / v.qtyAmt) * 100) : null
        return {
          week: v.weekStart.slice(5),  // MM-DD 형식
          weekFull: v.weekStart,
          ordAmt: Math.round(v.ordAmt),
          qtyAmt: Math.round(v.qtyAmt),
          recAmt: Math.round(v.recAmt),
          confirmRate,
          fulfillRate,
        }
      })
  }, [filtered, chartFrom, chartTo])

  // 공급 현황 테이블 — tableFrom~tableTo 필터, 입고예정일 내림차순
  const tableByDate = useMemo(() => {
    const byDate: Record<string, { ord:number; qty:number; rec:number; unp:number; ordAmt:number; confAmt:number; recAmt:number; count:number }> = {}
    filtered.filter(r => { const d=toD(r.입고예정일); return d>=tableFrom&&d<=tableTo }).forEach(r => {
      const d = toD(r.입고예정일)
      if (!byDate[d]) byDate[d] = { ord:0, qty:0, rec:0, unp:0, ordAmt:0, confAmt:0, recAmt:0, count:0 }
      const ord=toN(r.발주수량), qty=toN(r.확정수량), rec=toN(r.입고수량), mp=toN(r.매입가)
      byDate[d].ord     += ord
      byDate[d].qty     += qty
      byDate[d].rec     += rec
      byDate[d].unp     += qty - rec
      byDate[d].ordAmt  += ord * mp
      byDate[d].confAmt += qty * mp
      byDate[d].recAmt  += rec * mp
      byDate[d].count   += 1
    })
    return Object.entries(byDate).sort(([a],[b]) => b.localeCompare(a))
  }, [filtered, tableFrom, tableTo])

  // 이동중 파이프라인 — filteredAll 기준 (검색 반영), products.name SUM
  const movingByDate = useMemo(() => {
    const mv = filteredAll.filter(r => toD(r.입고예정일) >= today && toN(r.입고수량) === 0)
    const byDate: Record<string, Record<string, { name:string; image_url:string; qty:number; amt:number }>> = {}
    mv.forEach(r => {
      const d = toD(r.입고예정일)
      const pName = prodMap[r['SKU Barcode']]?.name || r['SKU 이름']
      const img   = prodMap[r['SKU Barcode']]?.image_url || ''
      if (!byDate[d]) byDate[d] = {}
      if (!byDate[d][pName]) byDate[d][pName] = { name:pName, image_url:img, qty:0, amt:0 }
      byDate[d][pName].qty += toN(r.확정수량)
      byDate[d][pName].amt += toN(r.확정수량) * toN(r.매입가)
    })
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
      .map(([date, nameMap]) => [
        date,
        Object.values(nameMap)
          .filter(item => item.qty > 0 && item.amt > 0)  // 0개, 0원 제품 제외
          .sort((a,b) => b.amt - a.amt)  // 공급액 내림차순
      ] as [string, {name:string;image_url:string;qty:number;amt:number}[]])
      .filter(([, items]) => items.length > 0)  // 빈 날짜 제외
  }, [filteredAll, prodMap])

  const kpiCards = [
    { label:'전일 확정수량', sub: yesterdayStr,   kpi: kpiYest,   color:'var(--blue)',   ico:'📦', cls:'kc-bl' },
    { label:'주간 확정수량', sub:`${weekRange.from.slice(5)}~${weekRange.to.slice(5)}`, kpi: kpiWeek, color:'var(--purple)', ico:'📅', cls:'kc-pu' },
    { label:'누적 확정수량', sub:'26년 1/1~',      kpi: kpiCum,    color:'var(--green)',  ico:'📊', cls:'kc-gr' },
    { label:'이동중 확정수량', sub:'오늘~ 미입고',  kpi: kpiMoving, color:'var(--amber)',  ico:'🚢', cls:'kc-am' },
  ]

  const KpiRow = ({ label, qty, amt, color }: { label:string; qty:number; amt:number; color?:string }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:3 }}>
      <span style={{ fontSize:10, color:'var(--t3)', minWidth:28 }}>{label}</span>
      <div style={{ textAlign:'right' }}>
        <span style={{ fontSize:11, fontWeight:700, color: color||'var(--text)' }}>{fmt(qty)}</span>
        <span style={{ fontSize:10, color:'var(--t3)', marginLeft:6 }}>{fmt(amt)}원</span>
      </div>
    </div>
  )

  return (
    <div>
      {/* 최상단 검색창 */}
      <div style={{ marginBottom:12 }}>
        <input className="si" placeholder="🔍 상품명/바코드 전체 검색" value={search} onChange={e => setSearch(e.target.value)}
          style={{ width:'100%' }} />
      </div>

      {/* KPI 카드 */}
      <div className="krow" style={{ marginBottom: 16 }}>
        {kpiCards.map((c, i) => (
          <div key={i} className={`kpi ${c.cls}`}>
            <div className="kpi-top"><div className="kpi-ico">{c.ico}</div></div>
            <div className="kpi-lbl">{c.label}</div>
            {/* 수량/금액 행 */}
            <div style={{ marginTop:8 }}>
              <KpiRow label="발주" qty={loading?0:c.kpi.ord} amt={loading?0:c.kpi.ordAmt} />
              <KpiRow label="확정" qty={loading?0:c.kpi.qty} amt={loading?0:c.kpi.confAmt} color={c.color} />
              <KpiRow label="입고" qty={loading?0:c.kpi.rec} amt={loading?0:c.kpi.recAmt} color="var(--green)" />
            </div>
            <div style={{ marginTop:5, paddingTop:5, borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', fontSize:10 }}>
              <span style={{ color:'var(--t3)' }}>공급률</span>
              <span style={{ fontWeight:800, color: c.kpi.rate>=100?'var(--green)':c.kpi.rate>=50?'var(--amber)':'#ef4444' }}>
                {loading?'—':c.kpi.rate+'%'}
              </span>
            </div>
            <div style={{ fontSize:9, color:'var(--t3)', marginTop:4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 발주·공급·입고 비교 꺾은선 차트 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📈</div><div>
            <div className="ch-title">발주 · 확정 · 입고 금액 비교</div>
            <div className="ch-sub">입고예정일 기준 · 매입가 × 수량 (VAT 별도)</div>
          </div></div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="date" value={chartFrom} onChange={e => setChartFrom(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
            <span style={{ fontSize:11, color:'var(--t3)' }}>~</span>
            <input type="date" value={chartTo} onChange={e => setChartTo(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
          </div>
        </div>
        <div className="cb">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top:8, right:20, left:0, bottom:5 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="date" tick={{ fontSize:10 }} interval="preserveStartEnd"/>
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize:10 }}
                  width={56}
                  tickFormatter={(v:number) => {
                    if (v >= 100_000_000) return `${(v/100_000_000).toFixed(1)}억`
                    if (v >= 10_000_000) return `${Math.round(v/1_000_000)}백만`
                    if (v >= 10_000) return `${Math.round(v/10_000)}만`
                    return String(v)
                  }}
                />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize:10, fill:'#94a3b8' }} width={36} unit="%"/>
                <Tooltip
                  formatter={(val:number, name:string) => {
                    if (name === '공급률') return [val == null ? '-' : `${val}%`, name]
                    return [fmt(val) + '원', name]
                  }}
                  labelFormatter={l => `날짜: ${l}`}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:11 }}/>
                {/* 발주/확정/입고 금액 (qty × 매입가, VAT 별도): 그룹 막대 */}
                <Bar yAxisId="left" dataKey="ordAmt" name="발주금액" fill="#93C5FD" radius={[3,3,0,0]}/>
                <Bar yAxisId="left" dataKey="qtyAmt" name="확정금액" fill="#A855F7" radius={[3,3,0,0]}/>
                <Bar yAxisId="left" dataKey="recAmt" name="입고금액" fill="#10B981" radius={[3,3,0,0]}/>
                {/* 전년 같은 MM-DD 입고금액 (점선, 회색) — 비교용 */}
                <Line yAxisId="left" type="monotone" dataKey="prevRecAmt" name={`${yearPrev}년 입고금액`} stroke="#64748b" strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls={false}/>
                {/* 공급률(확정/발주, 금액 기준) — 우측 축, % */}
                <Line yAxisId="right" type="monotone" dataKey="confirmRate" name="공급률" stroke="#f59e0b" strokeWidth={1.5} dot={{ r:2 }} connectNulls={false}/>
                {(() => {
                  const t = new Date()
                  const todayMD = `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`
                  // 이번 주 (월~일) 범위
                  const dow = t.getDay()
                  const monOffset = dow === 0 ? -6 : 1 - dow
                  const mon = new Date(t); mon.setDate(t.getDate() + monOffset)
                  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
                  const monMD = `${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`
                  const sunMD = `${String(sun.getMonth()+1).padStart(2,'0')}-${String(sun.getDate()).padStart(2,'0')}`
                  const dataDates = chartData.map(d => d.date)
                  const weekShown = dataDates.some(d => d >= monMD && d <= sunMD)
                  const todayShown = dataDates.includes(todayMD)
                  return (
                    <>
                      {weekShown && <ReferenceArea yAxisId="left" x1={monMD} x2={sunMD} fill="#fde68a" fillOpacity={0.15} ifOverflow="hidden"/>}
                      {todayShown && <ReferenceLine yAxisId="left" x={todayMD} stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1.5} label={{ value:'오늘', position:'top', fontSize:10, fill:'#dc2626', fontWeight:700 }}/>}
                    </>
                  )
                })()}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-st" style={{ height:280 }}><div className="es-ico">📊</div><div className="es-t">{loading?'로딩 중...':'데이터 없음'}</div></div>
          )}
        </div>
      </div>

      {/* 주간 집계 차트 — 일별을 월요일 시작 주차로 묶음 */}
      {weeklyChartData.length >= 2 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">📅</div><div>
              <div className="ch-title">주간 발주 · 확정 · 입고 금액</div>
              <div className="ch-sub">월요일 시작 주차 · 매입가 × 수량 합계 (VAT 별도)</div>
            </div></div>
          </div>
          <div className="cb">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={weeklyChartData} margin={{ top:8, right:20, left:0, bottom:5 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="week" tick={{ fontSize:10 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize:10 }}
                  width={56}
                  tickFormatter={(v:number) => {
                    if (v >= 100_000_000) return `${(v/100_000_000).toFixed(1)}억`
                    if (v >= 10_000_000) return `${Math.round(v/1_000_000)}백만`
                    if (v >= 10_000) return `${Math.round(v/10_000)}만`
                    return String(v)
                  }}
                />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize:10, fill:'#94a3b8' }} width={36} unit="%"/>
                <Tooltip
                  formatter={(val:number, name:string) => {
                    if (name === '공급률' || name === '입고율') return [val == null ? '-' : `${val}%`, name]
                    return [fmt(val) + '원', name]
                  }}
                  labelFormatter={l => `주 시작: ${l}`}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:11 }}/>
                <Bar yAxisId="left" dataKey="ordAmt" name="발주금액" fill="#93C5FD" radius={[3,3,0,0]}/>
                <Bar yAxisId="left" dataKey="qtyAmt" name="확정금액" fill="#A855F7" radius={[3,3,0,0]}/>
                <Bar yAxisId="left" dataKey="recAmt" name="입고금액" fill="#10B981" radius={[3,3,0,0]}/>
                <Line yAxisId="right" type="monotone" dataKey="confirmRate" name="공급률" stroke="#f59e0b" strokeWidth={1.5} dot={{ r:2 }} connectNulls={false}/>
                <Line yAxisId="right" type="monotone" dataKey="fulfillRate" name="입고율" stroke="#0891b2" strokeWidth={1.5} dot={{ r:2 }} strokeDasharray="3 3" connectNulls={false}/>
                {(() => {
                  const t = new Date()
                  const dow = t.getDay()
                  const monOffset = dow === 0 ? -6 : 1 - dow
                  const mon = new Date(t); mon.setDate(t.getDate() + monOffset)
                  const md = `${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`
                  return weeklyChartData.some(d => d.week === md)
                    ? <ReferenceLine yAxisId="left" x={md} stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1.5} label={{ value:'이번 주', position:'top', fontSize:10, fill:'#dc2626', fontWeight:700 }}/>
                    : null
                })()}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 공급 현황 테이블 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">🚚</div><div>
            <div className="ch-title">공급 현황</div>
            <div className="ch-sub">입고예정일 기준 집계 · {tableByDate.length}일 · 클릭하면 상세 펼침</div>
          </div></div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="date" value={tableFrom} onChange={e => setTableFrom(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
            <span style={{ fontSize:11, color:'var(--t3)' }}>~</span>
            <input type="date" value={tableTo} onChange={e => setTableTo(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
          </div>
        </div>
        <div className="cb">
          {loading ? (
            <div className="empty-st"><div className="es-ico">🚚</div><div className="es-t">로딩 중...</div></div>
          ) : tableByDate.length === 0 ? (
            <div className="empty-st"><div className="es-ico">📦</div><div className="es-t">데이터 없음</div></div>
          ) : (
            <div className="tw" style={{ overflowX:'auto' }}>
              <table style={{ minWidth:800 }}>
                <thead><tr>
                  <th style={{ width:36 }}>주차</th>
                  <th>입고예정일</th>
                  <th style={{ textAlign:'right' }}>품목수</th>
                  <th style={{ textAlign:'right' }}>발주수량</th>
                  <th style={{ textAlign:'right' }}>확정수량</th>
                  <th style={{ textAlign:'right' }}>입고수량</th>
                  <th style={{ textAlign:'right' }}>미납수량</th>
                  <th style={{ textAlign:'right' }}>공급률</th>
                  <th style={{ textAlign:'right' }}>발주금액</th>
                  <th style={{ textAlign:'right' }}>확정금액</th>
                  <th style={{ textAlign:'right' }}>입고금액</th>
                </tr></thead>
                <tbody>
                  {tableByDate.map(([date, v]) => {
                    const rate = v.ord > 0 ? Math.round(v.qty / v.ord * 100) : 0
                    const isExpanded = expandedDates.has(date)
                    const dateRows = filtered.filter(r => toD(r.입고예정일) === date)
                    return (
                      <>
                        <tr key={date}
                          style={{ cursor:'pointer', background: date === today ? 'rgba(59,130,246,0.05)' : undefined }}
                          onClick={() => setExpandedDates(prev => {
                            const next = new Set(prev); next.has(date) ? next.delete(date) : next.add(date); return next
                          })}
                        >
                          <td style={{ fontSize:10, fontWeight:800, color:'var(--t3)', textAlign:'center' }}>{getWeekLabel(date)}</td>
                          <td style={{ fontWeight:700, fontSize:12, whiteSpace:'nowrap' }}>
                            {isExpanded ? '▲ ' : '▼ '}{date}
                            {date === today && <span style={{ fontSize:9, background:'var(--blue)', color:'#fff', borderRadius:4, padding:'1px 5px', marginLeft:6 }}>오늘</span>}
                          </td>
                          <td style={{ textAlign:'right', fontSize:11, color:'var(--t3)' }}>{v.count}건</td>
                          <td style={{ textAlign:'right' }}>{fmt(v.ord)}</td>
                          <td style={{ textAlign:'right', color:'var(--blue)', fontWeight:700 }}>{fmt(v.qty)}</td>
                          <td style={{ textAlign:'right', color:'var(--green)', fontWeight:700 }}>{fmt(v.rec)}</td>
                          <td style={{ textAlign:'right', color: v.unp>0?'#ef4444':'var(--t3)', fontWeight: v.unp>0?700:400 }}>{fmt(v.unp)}</td>
                          <td style={{ textAlign:'right' }}>
                            <span style={{ fontSize:10, fontWeight:700, color: rate>=100?'var(--green)':rate>=50?'var(--amber)':'#ef4444' }}>{rate}%</span>
                          </td>
                          <td style={{ textAlign:'right', fontSize:11 }}>{fmt(v.ordAmt)}</td>
                          <td style={{ textAlign:'right', fontSize:11, color:'var(--blue)' }}>{fmt(v.confAmt)}</td>
                          <td style={{ textAlign:'right', fontSize:11, color:'var(--green)' }}>{fmt(v.recAmt)}</td>
                        </tr>
                        {isExpanded && dateRows.map((r, i) => {
                          const ord=toN(r.발주수량), qty=toN(r.확정수량), rec=toN(r.입고수량), mp=toN(r.매입가)
                          const unp=qty-rec, rate2=ord>0?Math.round(qty/ord*100):0
                          return (
                            <tr key={`${date}-${i}`} style={{ background:'var(--bg)', fontSize:11 }}>
                              <td></td>
                              <td style={{ paddingLeft:20, fontSize:10, color:'var(--t3)', whiteSpace:'nowrap' }}>{r['SKU Barcode']}</td>
                              <td style={{ fontSize:10, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text)' }} title={r.name||r['SKU 이름']}>{r.name||r['SKU 이름']}</td>
                              <td style={{ textAlign:'right' }}>{fmt(ord)}</td>
                              <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmt(qty)}</td>
                              <td style={{ textAlign:'right', color:'var(--green)' }}>{fmt(rec)}</td>
                              <td style={{ textAlign:'right', color: unp>0?'#ef4444':'var(--t3)' }}>{fmt(unp)}</td>
                              <td style={{ textAlign:'right' }}><span style={{ fontSize:10, color: rate2>=100?'var(--green)':rate2>=50?'var(--amber)':'#ef4444' }}>{rate2}%</span></td>
                              <td style={{ textAlign:'right' }}>{fmt(ord*mp)}</td>
                              <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmt(qty*mp)}</td>
                              <td style={{ textAlign:'right', color:'var(--green)' }}>{fmt(rec*mp)}</td>
                            </tr>
                          )
                        })}
                      </>
                    )
                  })}
                  {/* 서브토탈 행 */}
                  {tableByDate.length > 0 && (() => {
                    const total = tableByDate.reduce((acc, [, v]) => ({
                      ord:     acc.ord     + v.ord,
                      qty:     acc.qty     + v.qty,
                      rec:     acc.rec     + v.rec,
                      unp:     acc.unp     + v.unp,
                      ordAmt:  acc.ordAmt  + v.ordAmt,
                      confAmt: acc.confAmt + v.confAmt,
                      recAmt:  acc.recAmt  + v.recAmt,
                      count:   acc.count   + v.count,
                    }), { ord:0, qty:0, rec:0, unp:0, ordAmt:0, confAmt:0, recAmt:0, count:0 })
                    const totalRate = total.ord > 0 ? Math.round(total.qty / total.ord * 100) : 0
                    return (
                      <tr style={{ background:'rgba(59,130,246,0.06)', borderTop:'2px solid var(--border)', fontWeight:800 }}>
                        <td style={{ textAlign:'center', fontSize:10, color:'var(--t3)' }}>합계</td>
                        <td style={{ fontSize:12, color:'var(--text)', paddingLeft:8 }}>전체 {tableByDate.length}일</td>
                        <td style={{ textAlign:'right', fontSize:11, color:'var(--t3)' }}>{total.count}건</td>
                        <td style={{ textAlign:'right' }}>{fmt(total.ord)}</td>
                        <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmt(total.qty)}</td>
                        <td style={{ textAlign:'right', color:'var(--green)' }}>{fmt(total.rec)}</td>
                        <td style={{ textAlign:'right', color: total.unp>0?'#ef4444':'var(--t3)' }}>{fmt(total.unp)}</td>
                        <td style={{ textAlign:'right' }}>
                          <span style={{ fontSize:10, color: totalRate>=100?'var(--green)':totalRate>=50?'var(--amber)':'#ef4444' }}>{totalRate}%</span>
                        </td>
                        <td style={{ textAlign:'right', fontSize:11 }}>{fmt(total.ordAmt)}</td>
                        <td style={{ textAlign:'right', fontSize:11, color:'var(--blue)' }}>{fmt(total.confAmt)}</td>
                        <td style={{ textAlign:'right', fontSize:11, color:'var(--green)' }}>{fmt(total.recAmt)}</td>
                      </tr>
                    )
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 이동중 파이프라인 — supply_status 기준, products.name SUM */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">🚢</div><div>
            <div className="ch-title">이동중 파이프라인</div>
            <div className="ch-sub">입고예정일 ≥ 오늘 · 입고수량 = 0 · 상품명 기준 합산</div>
          </div></div>
          <div style={{ fontSize:11, color:'var(--t3)', fontWeight:700 }}>총 {fmt(kpiMoving.qty)}개 · {fmt(kpiMoving.confAmt)}원</div>
        </div>
        <div className="cb">
          {loading ? (
            <div className="empty-st"><div className="es-ico">🚢</div><div className="es-t">로딩 중...</div></div>
          ) : movingByDate.length > 0 ? (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {movingByDate.map(([date, items]) => {
                const dayQty = items.reduce((s,r)=>s+r.qty,0)
                const dayAmt = items.reduce((s,r)=>s+r.amt,0)
                return (
                  <div key={date} style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                    <div style={{ background:'var(--bg)', padding:'8px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)' }}>
                      <div style={{ fontWeight:800, fontSize:13 }}>
                        📅 {date}
                        <span style={{ fontSize:11, fontWeight:600, color:'var(--t3)', marginLeft:8 }}>{getWeekLabel(date)}</span>
                      </div>
                      <div style={{ fontSize:11, color:'var(--t3)' }}>{items.length}품목 · {fmt(dayQty)}개 · {fmt(dayAmt)}원</div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:8, padding:12 }}>
                      {items.map((item, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg)', borderRadius:8, padding:'8px 10px', border:'1px solid var(--border)' }}>
                          {item.image_url
                            ? <img src={item.image_url} alt="" style={{ width:36, height:36, borderRadius:6, objectFit:'cover', flexShrink:0 }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                            : <div style={{ width:36, height:36, borderRadius:6, background:'var(--card)', border:'1px solid var(--border)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10 }}>📦</div>}
                          <div style={{ overflow:'hidden', flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.name}</div>
                            <div style={{ fontSize:11, fontWeight:800, color:'var(--amber)', marginTop:3 }}>{fmt(item.qty)}개 · {fmt(item.amt)}원</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-st">
              <div className="es-ico">🚢</div>
              <div className="es-t">이동중 상품 없음</div>
              <div style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>입고예정일이 오늘 이후이고 입고수량이 0인 데이터가 없습니다</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

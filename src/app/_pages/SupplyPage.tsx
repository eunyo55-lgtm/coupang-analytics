'use client'
import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

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

function getThreeMonthsAgo() {
  const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0,10)
}

export default function SupplyPage() {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const today = new Date().toISOString().slice(0, 10)

  const threeMonthsAgo = getThreeMonthsAgo()

  const [rows, setRows] = useState<SupplyRow[]>([])       // 필터 기간 (차트/테이블)
  const [allRows, setAllRows] = useState<SupplyRow[]>([])  // 전체 기간 (KPI용)
  const [prodMap, setProdMap] = useState<Record<string,{name:string;image_url:string}>>({})
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => getThreeMonthsAgo())
  const [dateTo, setDateTo] = useState('2026-12-31')
  const [search, setSearch] = useState('')
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())

  const weekRange = useMemo(() => {
    const d = new Date(), dow = d.getDay()
    const lastThu = new Date(d); lastThu.setDate(d.getDate() - ((dow + 3) % 7 + 1))
    const lastFri = new Date(lastThu); lastFri.setDate(lastThu.getDate() - 6)
    return { from: lastFri.toISOString().slice(0,10), to: lastThu.toISOString().slice(0,10) }
  }, [])

  // ── 전체 데이터 로드 (KPI용, 최초 1회) ──
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
          확정수량: toN(r.확정수량), 입고수량: toN(r.입고수량), 매입가: toN(r.매입가),
        })))
        if (page.length < 1000) break
        offset += 1000
      }
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
      setProdMap(pm)
    }
    loadAll()
  }, [])

  // ── 날짜 필터 기간 데이터 로드 (차트/테이블용) ──
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
        const from = dateFrom || threeMonthsAgo
        const to   = dateTo   || '2099-12-31'

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

        setRows(allData.map(r => ({
          ...r,
          발주수량: toN(r.발주수량), 확정수량: toN(r.확정수량),
          입고수량: toN(r.입고수량), 매입가: toN(r.매입가),
          name:      prodMap[r['SKU Barcode']]?.name || r['SKU 이름'],
          image_url: prodMap[r['SKU Barcode']]?.image_url || '',
        })))
      } catch (e) { console.warn(e) }
      setLoading(false)
    }
    load()
  }, [dateFrom, dateTo, prodMap])

  const filtered = useMemo(() => rows.filter(r => {
    return !search || (r.name||r['SKU 이름']).toLowerCase().includes(search.toLowerCase()) || r['SKU Barcode'].includes(search)
  }), [rows, search])

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

  const kpiYest   = useMemo(() => calcKpi(allRows.filter(r => toD(r.입고예정일) === yesterdayStr)), [allRows])
  const kpiWeek   = useMemo(() => calcKpi(allRows.filter(r => { const d=toD(r.입고예정일); return d>=weekRange.from&&d<=weekRange.to })), [allRows, weekRange])
  const kpiCum    = useMemo(() => calcKpi(allRows.filter(r => toD(r.입고예정일) >= '2026-01-01')), [allRows])
  const kpiMoving = useMemo(() => calcKpi(allRows.filter(r => toD(r.입고예정일) >= today && toN(r.입고수량) === 0)), [allRows])

  // 차트 — 날짜별 발주/확정/입고 수량
  const chartData = useMemo(() => {
    const byDate: Record<string, { ord: number; qty: number; rec: number }> = {}
    filtered.forEach(r => {
      const d = toD(r.입고예정일)
      if (!byDate[d]) byDate[d] = { ord: 0, qty: 0, rec: 0 }
      byDate[d].ord += toN(r.발주수량)
      byDate[d].qty += toN(r.확정수량)
      byDate[d].rec += toN(r.입고수량)
    })
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }))
  }, [filtered])

  // 공급 현황 테이블 — 입고예정일 기준 집계
  const tableByDate = useMemo(() => {
    const byDate: Record<string, { ord:number; qty:number; rec:number; unp:number; ordAmt:number; confAmt:number; recAmt:number; count:number }> = {}
    filtered.forEach(r => {
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
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
  }, [filtered])

  // 이동중 파이프라인 — allRows 기준, products.name SUM
  const movingByDate = useMemo(() => {
    const mv = allRows.filter(r => toD(r.입고예정일) >= today && toN(r.입고수량) === 0)
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
      .map(([date, nameMap]) => [date, Object.values(nameMap)] as [string, {name:string;image_url:string;qty:number;amt:number}[]])
  }, [allRows, prodMap])

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
            <div className="ch-title">발주 · 확정 · 입고 비교</div>
            <div className="ch-sub">입고예정일 기준 수량 추이</div>
          </div></div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
            <span style={{ fontSize:11, color:'var(--t3)' }}>~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
          </div>
        </div>
        <div className="cb">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top:8, right:20, left:0, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="date" tick={{ fontSize:10 }} interval="preserveStartEnd"/>
                <YAxis tick={{ fontSize:10 }} width={45}/>
                <Tooltip formatter={(val:number, name:string) => [fmt(val)+'개', name]} labelFormatter={l=>`날짜: ${l}`}/>
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:11 }}/>
                <Line type="monotone" dataKey="ord" name="발주수량" stroke="#3B82F6" strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="qty" name="확정수량" stroke="#A855F7" strokeWidth={2.5} dot={false}/>
                <Line type="monotone" dataKey="rec" name="입고수량" stroke="#10B981" strokeWidth={2} dot={false} strokeDasharray="4 2"/>
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-st" style={{ height:260 }}><div className="es-ico">📈</div><div className="es-t">{loading?'로딩 중...':'데이터 없음'}</div></div>
          )}
        </div>
      </div>

      {/* 공급 현황 테이블 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">🚚</div><div>
            <div className="ch-title">공급 현황</div>
            <div className="ch-sub">입고예정일 기준 집계 · {tableByDate.length}일 · 클릭하면 상세 펼침</div>
          </div></div>
          <input className="si" placeholder="🔍 상품명/바코드" value={search} onChange={e => setSearch(e.target.value)} style={{ width:160 }} />
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

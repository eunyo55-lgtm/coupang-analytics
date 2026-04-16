'use client'
import { useState, useEffect, useMemo } from 'react'

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI'

type SupplyRow = {
  발주번호?: string | number
  'SKU ID'?: string | number
  'SKU 이름': string
  'SKU Barcode': string
  물류센터?: string
  입고예정일: string
  발주일?: string
  발주수량: number | string
  확정수량: number | string
  입고수량: number | string
  image_url?: string
  option_value?: string
  cost?: number
}

function toD(s: unknown) { return s ? String(s).slice(0, 10) : '' }
function toN(v: unknown) { return Number(v) || 0 }

export default function SupplyPage() {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const today = new Date().toISOString().slice(0, 10)

  const [rows, setRows] = useState<SupplyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('2026-01-01')
  const [dateTo, setDateTo] = useState('2026-12-31')
  const [search, setSearch] = useState('')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  const weekRange = useMemo(() => {
    const d = new Date(), dow = d.getDay()
    const lastThu = new Date(d); lastThu.setDate(d.getDate() - ((dow + 3) % 7 + 1))
    const lastFri = new Date(lastThu); lastFri.setDate(lastThu.getDate() - 6)
    return { from: lastFri.toISOString().slice(0,10), to: lastThu.toISOString().slice(0,10) }
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
        const r = await fetch(`${SUPA_URL}/rest/v1/supply_status?select=*&order=입고예정일.asc&limit=5000`, { headers: h })
        const data: SupplyRow[] = await r.json()
        if (!Array.isArray(data)) { setLoading(false); return }

        const barcodes = [...new Set(data.map(r => r['SKU Barcode']).filter(Boolean))]
        const prodMap: Record<string, { cost: number; image_url: string; option_value: string }> = {}
        for (let i = 0; i < barcodes.length; i += 200) {
          const batch = barcodes.slice(i, i + 200)
          try {
            const pr = await fetch(`${SUPA_URL}/rest/v1/products?select=barcode,cost,image_url,option_value&barcode=in.(${batch.map(b => `"${b}"`).join(',')})`, { headers: h })
            const pdata: { barcode: string; cost: number; image_url: string; option_value: string }[] = await pr.json()
            if (Array.isArray(pdata)) pdata.forEach(p => { prodMap[p.barcode] = { cost: p.cost, image_url: p.image_url, option_value: p.option_value } })
          } catch { /* ignore */ }
        }

        setRows(data.map(r => ({
          ...r,
          발주수량: toN(r.발주수량),
          확정수량: toN(r.확정수량),
          입고수량: toN(r.입고수량),
          cost: prodMap[r['SKU Barcode']]?.cost || 0,
          image_url: prodMap[r['SKU Barcode']]?.image_url || '',
          option_value: prodMap[r['SKU Barcode']]?.option_value || '',
        })))
      } catch (e) { console.warn(e) }
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => rows.filter(r => {
    const d = toD(r.입고예정일)
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo) &&
      (!search || r['SKU 이름'].toLowerCase().includes(search.toLowerCase()) || r['SKU Barcode'].includes(search))
  }), [rows, dateFrom, dateTo, search])

  // KPI 계산: qty=확정수량, ord=발주수량, rec=입고수량, cost 기반 금액
  function calcKpi(rowSet: SupplyRow[]) {
    const qty = rowSet.reduce((s,r) => s + toN(r.확정수량), 0)
    const ord = rowSet.reduce((s,r) => s + toN(r.발주수량), 0)
    const rec = rowSet.reduce((s,r) => s + toN(r.입고수량), 0)
    const confirmedAmt = rowSet.reduce((s,r) => s + toN(r.확정수량) * (r.cost||0), 0)
    const ordAmt       = rowSet.reduce((s,r) => s + toN(r.발주수량) * (r.cost||0), 0)
    const recAmt       = rowSet.reduce((s,r) => s + toN(r.입고수량) * (r.cost||0), 0)
    const supplyRate   = ord > 0 ? Math.round(qty / ord * 100) : 0
    return { qty, ord, rec, confirmedAmt, ordAmt, recAmt, supplyRate }
  }

  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1)
  const yesterdayStr = yesterday.toISOString().slice(0,10)

  const kpiYest   = useMemo(() => calcKpi(rows.filter(r => toD(r.입고예정일) === yesterdayStr)), [rows])
  const kpiWeek   = useMemo(() => calcKpi(rows.filter(r => { const d=toD(r.입고예정일); return d>=weekRange.from&&d<=weekRange.to })), [rows, weekRange])
  const kpiCum    = useMemo(() => calcKpi(rows.filter(r => toD(r.입고예정일) >= '2026-01-01')), [rows])
  const kpiMoving = useMemo(() => calcKpi(rows.filter(r => toD(r.입고예정일) >= today && toN(r.입고수량) === 0)), [rows])

  const unpaid = useMemo(() => filtered.filter(r => toN(r.확정수량) > toN(r.입고수량) && toN(r.확정수량) > 0), [filtered])

  const movingByDate = useMemo(() => {
    const mv = rows.filter(r => toD(r.입고예정일) >= today && toN(r.입고수량) === 0)
    const byDate: Record<string, SupplyRow[]> = {}
    mv.forEach(r => { const d=toD(r.입고예정일); if(!byDate[d]) byDate[d]=[]; byDate[d].push(r) })
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
  }, [rows])

  const toggleRow = (i: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const kpiCards = [
    { label:'전일 확정수량', sub: yesterdayStr, kpi: kpiYest, color:'var(--blue)', ico:'📦', cls:'kc-bl' },
    { label:'주간 확정수량', sub:`${weekRange.from.slice(5)}~${weekRange.to.slice(5)} (금~목)`, kpi: kpiWeek, color:'var(--purple)', ico:'📅', cls:'kc-pu' },
    { label:'누적 확정수량', sub:'26년 1/1~', kpi: kpiCum, color:'var(--green)', ico:'📊', cls:'kc-gr' },
    { label:'이동중 확정수량', sub:'오늘~ 미입고', kpi: kpiMoving, color:'var(--amber)', ico:'🚢', cls:'kc-am' },
  ]

  return (
    <div>
      {/* KPI 카드 */}
      <div className="krow" style={{ marginBottom: 16 }}>
        {kpiCards.map((c, i) => (
          <div key={i} className={`kpi ${c.cls}`}>
            <div className="kpi-top"><div className="kpi-ico">{c.ico}</div></div>
            <div className="kpi-lbl">{c.label}</div>
            <div className="kpi-val" style={{ color: c.color }}>{loading ? '—' : fmt(c.kpi.qty)}</div>
            {/* 세부 데이터 */}
            <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:2 }}>
              <div style={{ fontSize:10, color:'var(--t3)', display:'flex', justifyContent:'space-between' }}>
                <span>확정금액</span><span style={{ color:'var(--text)', fontWeight:700 }}>{loading ? '—' : fmt(c.kpi.confirmedAmt)}원</span>
              </div>
              <div style={{ fontSize:10, color:'var(--t3)', display:'flex', justifyContent:'space-between' }}>
                <span>발주수량</span><span style={{ color:'var(--text)', fontWeight:700 }}>{loading ? '—' : fmt(c.kpi.ord)}</span>
              </div>
              <div style={{ fontSize:10, color:'var(--t3)', display:'flex', justifyContent:'space-between' }}>
                <span>발주금액</span><span style={{ color:'var(--text)', fontWeight:700 }}>{loading ? '—' : fmt(c.kpi.ordAmt)}원</span>
              </div>
              <div style={{ fontSize:10, color:'var(--t3)', display:'flex', justifyContent:'space-between' }}>
                <span>입고수량</span><span style={{ color:'var(--green)', fontWeight:700 }}>{loading ? '—' : fmt(c.kpi.rec)}</span>
              </div>
              <div style={{ fontSize:10, color:'var(--t3)', display:'flex', justifyContent:'space-between' }}>
                <span>입고금액</span><span style={{ color:'var(--green)', fontWeight:700 }}>{loading ? '—' : fmt(c.kpi.recAmt)}원</span>
              </div>
              <div style={{ fontSize:10, color:'var(--t3)', display:'flex', justifyContent:'space-between' }}>
                <span>공급률</span>
                <span style={{ fontWeight:800, color: c.kpi.supplyRate>=100?'var(--green)':c.kpi.supplyRate>=50?'var(--amber)':'#ef4444' }}>
                  {loading ? '—' : c.kpi.supplyRate + '%'}
                </span>
              </div>
            </div>
            <div style={{ fontSize:9, color:'var(--t3)', marginTop:4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 공급 현황 리스트 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">🚚</div><div>
            <div className="ch-title">공급 현황</div>
            <div className="ch-sub">입고예정일 기준 · {filtered.length}건</div>
          </div></div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
            <span style={{ fontSize:11, color:'var(--t3)' }}>~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)' }} />
            <input className="si" placeholder="🔍 상품명/바코드" value={search} onChange={e => setSearch(e.target.value)} style={{ width:160 }} />
          </div>
        </div>
        <div className="cb">
          {loading ? (
            <div className="empty-st"><div className="es-ico">🚚</div><div className="es-t">로딩 중...</div></div>
          ) : rows.length === 0 ? (
            <div className="empty-st"><div className="es-ico">📦</div><div className="es-t">데이터 없음</div><div style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>Supabase supply_status 테이블에 데이터를 업로드해주세요</div></div>
          ) : (
            <div className="tw" style={{ overflowX:'auto' }}>
              <table style={{ minWidth:900 }}>
                <thead><tr>
                  <th style={{ width:28 }}></th>
                  <th>입고예정일</th>
                  <th style={{ width:36 }}>이미지</th>
                  <th>상품명</th>
                  <th style={{ textAlign:'right' }}>확정수량</th>
                  <th style={{ textAlign:'right' }}>확정금액</th>
                  <th style={{ textAlign:'right' }}>발주수량</th>
                  <th style={{ textAlign:'right' }}>발주금액</th>
                  <th style={{ textAlign:'right' }}>입고수량</th>
                  <th style={{ textAlign:'right' }}>입고금액</th>
                  <th style={{ textAlign:'right' }}>공급률</th>
                </tr></thead>
                <tbody>
                  {filtered.length > 0 ? filtered.map((r, i) => {
                    const ord = toN(r.발주수량), sup = toN(r.확정수량), rec = toN(r.입고수량)
                    const rate = ord > 0 ? Math.round(sup / ord * 100) : 0
                    const cost = r.cost || 0
                    const expanded = expandedRows.has(i)
                    return (
                      <>
                        <tr key={i} style={{ cursor:'pointer' }} onClick={() => toggleRow(i)}>
                          <td style={{ textAlign:'center', fontSize:11, color:'var(--t3)' }}>
                            {expanded ? '▲' : '▼'}
                          </td>
                          <td style={{ fontSize:11, whiteSpace:'nowrap' }}>{toD(r.입고예정일)}</td>
                          <td>
                            {r.image_url
                              ? <img src={r.image_url} alt="" style={{ width:28, height:28, borderRadius:4, objectFit:'cover' }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                              : <div style={{ width:28, height:28, borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9 }}>-</div>}
                          </td>
                          <td style={{ fontWeight:700, maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r['SKU 이름']}</td>
                          <td style={{ textAlign:'right', color:'var(--blue)', fontWeight:700 }}>{fmt(sup)}</td>
                          <td style={{ textAlign:'right', fontSize:11, color:'var(--blue)' }}>{fmt(sup*cost)}</td>
                          <td style={{ textAlign:'right' }}>{fmt(ord)}</td>
                          <td style={{ textAlign:'right', fontSize:11 }}>{fmt(ord*cost)}</td>
                          <td style={{ textAlign:'right', color:'var(--green)', fontWeight:700 }}>{fmt(rec)}</td>
                          <td style={{ textAlign:'right', fontSize:11, color:'var(--green)' }}>{fmt(rec*cost)}</td>
                          <td style={{ textAlign:'right' }}>
                            <span style={{ fontSize:10, fontWeight:700, color: rate>=100?'var(--green)':rate>=50?'var(--amber)':'#ef4444' }}>{rate}%</span>
                          </td>
                        </tr>
                        {expanded && (
                          <tr key={`${i}-detail`} style={{ background:'var(--bg)' }}>
                            <td colSpan={11} style={{ padding:'8px 16px 10px 48px' }}>
                              <div style={{ display:'flex', gap:24, fontSize:11, color:'var(--t3)' }}>
                                <div>
                                  <span style={{ fontWeight:700, color:'var(--text)' }}>바코드: </span>
                                  <span>{r['SKU Barcode']}</span>
                                </div>
                                {r.option_value && (
                                  <div>
                                    <span style={{ fontWeight:700, color:'var(--text)' }}>옵션: </span>
                                    <span>{r.option_value}</span>
                                  </div>
                                )}
                                {r['SKU ID'] && (
                                  <div>
                                    <span style={{ fontWeight:700, color:'var(--text)' }}>SKU ID: </span>
                                    <span>{r['SKU ID']}</span>
                                  </div>
                                )}
                                {r.발주번호 && (
                                  <div>
                                    <span style={{ fontWeight:700, color:'var(--text)' }}>발주번호: </span>
                                    <span>{r.발주번호}</span>
                                  </div>
                                )}
                                {r.물류센터 && (
                                  <div>
                                    <span style={{ fontWeight:700, color:'var(--text)' }}>물류센터: </span>
                                    <span>{r.물류센터}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  }) : <tr><td colSpan={11}><div className="empty-st"><div className="es-ico">🔍</div><div className="es-t">해당 기간 데이터 없음</div></div></td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 미납 리스트 */}
      <div className="card" style={{ marginBottom:12 }}>
        <div className="ch"><div className="ch-l"><div className="ch-ico">⚠️</div><div>
          <div className="ch-title">미납 리스트</div>
          <div className="ch-sub">확정수량 &gt; 입고수량 ({unpaid.length}건)</div>
        </div></div></div>
        <div className="cb">
          <div className="tw" style={{ overflowX:'auto' }}>
            <table style={{ minWidth:900 }}>
              <thead><tr>
                <th style={{ width:28 }}></th>
                <th>입고예정일</th><th style={{ width:36 }}>이미지</th><th>상품명</th>
                <th style={{ textAlign:'right' }}>확정</th>
                <th style={{ textAlign:'right' }}>입고</th>
                <th style={{ textAlign:'right' }}>미납</th>
                <th style={{ textAlign:'right' }}>공급률</th>
                <th style={{ textAlign:'right' }}>확정금액</th>
                <th style={{ textAlign:'right' }}>입고금액</th>
                <th style={{ textAlign:'right' }}>미납금액</th>
              </tr></thead>
              <tbody>
                {unpaid.length > 0 ? unpaid.map((r, i) => {
                  const idx = 90000 + i
                  const sup=toN(r.확정수량), rec=toN(r.입고수량)
                  const unp=sup-rec, rate=sup>0?Math.round(rec/sup*100):0, cost=r.cost||0
                  const expanded = expandedRows.has(idx)
                  return (
                    <>
                      <tr key={i} style={{ cursor:'pointer' }} onClick={() => toggleRow(idx)}>
                        <td style={{ textAlign:'center', fontSize:11, color:'var(--t3)' }}>{expanded ? '▲' : '▼'}</td>
                        <td style={{ fontSize:11, whiteSpace:'nowrap' }}>{toD(r.입고예정일)}</td>
                        <td>
                          {r.image_url
                            ? <img src={r.image_url} alt="" style={{ width:28, height:28, borderRadius:4, objectFit:'cover' }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                            : <div style={{ width:28, height:28, borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9 }}>-</div>}
                        </td>
                        <td style={{ fontWeight:700, maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r['SKU 이름']}</td>
                        <td style={{ textAlign:'right', color:'var(--blue)', fontWeight:700 }}>{fmt(sup)}</td>
                        <td style={{ textAlign:'right', color:'var(--green)', fontWeight:700 }}>{fmt(rec)}</td>
                        <td style={{ textAlign:'right', fontWeight:700, color:'#ef4444' }}>{fmt(unp)}</td>
                        <td style={{ textAlign:'right' }}><span style={{ fontSize:10, fontWeight:700, color:rate>=100?'var(--green)':rate>=50?'var(--amber)':'#ef4444' }}>{rate}%</span></td>
                        <td style={{ textAlign:'right', fontSize:11, color:'var(--blue)' }}>{fmt(sup*cost)}</td>
                        <td style={{ textAlign:'right', fontSize:11, color:'var(--green)' }}>{fmt(rec*cost)}</td>
                        <td style={{ textAlign:'right', fontSize:11, fontWeight:700, color:'#ef4444' }}>{fmt(unp*cost)}</td>
                      </tr>
                      {expanded && (
                        <tr key={`${i}-detail`} style={{ background:'var(--bg)' }}>
                          <td colSpan={11} style={{ padding:'8px 16px 10px 48px' }}>
                            <div style={{ display:'flex', gap:24, fontSize:11, color:'var(--t3)' }}>
                              <div><span style={{ fontWeight:700, color:'var(--text)' }}>바코드: </span><span>{r['SKU Barcode']}</span></div>
                              {r.option_value && <div><span style={{ fontWeight:700, color:'var(--text)' }}>옵션: </span><span>{r.option_value}</span></div>}
                              {r['SKU ID'] && <div><span style={{ fontWeight:700, color:'var(--text)' }}>SKU ID: </span><span>{r['SKU ID']}</span></div>}
                              {r.발주번호 && <div><span style={{ fontWeight:700, color:'var(--text)' }}>발주번호: </span><span>{r.발주번호}</span></div>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                }) : <tr><td colSpan={11}><div className="empty-st"><div className="es-ico">✅</div><div className="es-t">미납 없음</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 이동중 파이프라인 */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">🚢</div><div>
            <div className="ch-title">이동중 파이프라인</div>
            <div className="ch-sub">입고예정일 ≥ 오늘 · 입고수량 = 0</div>
          </div></div>
          <div style={{ fontSize:11, color:'var(--t3)', fontWeight:700 }}>총 {fmt(kpiMoving.qty)}개 · {fmt(kpiMoving.confirmedAmt)}원</div>
        </div>
        <div className="cb">
          {loading ? (
            <div className="empty-st"><div className="es-ico">🚢</div><div className="es-t">로딩 중...</div></div>
          ) : movingByDate.length > 0 ? (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {movingByDate.map(([date, items]) => {
                const dayQty = items.reduce((s,r)=>s+toN(r.확정수량),0)
                const dayAmt = items.reduce((s,r)=>s+toN(r.확정수량)*(r.cost||0),0)
                return (
                  <div key={date} style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                    <div style={{ background:'var(--bg)', padding:'8px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)' }}>
                      <div style={{ fontWeight:800, fontSize:13 }}>📅 {date}</div>
                      <div style={{ fontSize:11, color:'var(--t3)' }}>{items.length}품목 · {fmt(dayQty)}개 · {fmt(dayAmt)}원</div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8, padding:12 }}>
                      {items.map((r, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg)', borderRadius:8, padding:'8px 10px', border:'1px solid var(--border)' }}>
                          {r.image_url
                            ? <img src={r.image_url} alt="" style={{ width:36, height:36, borderRadius:6, objectFit:'cover', flexShrink:0 }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                            : <div style={{ width:36, height:36, borderRadius:6, background:'var(--card)', border:'1px solid var(--border)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10 }}>📦</div>}
                          <div style={{ overflow:'hidden', flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r['SKU 이름']}</div>
                            <div style={{ fontSize:10, color:'var(--t3)', marginTop:1 }}>{r['SKU Barcode']}</div>
                            {r.option_value && <div style={{ fontSize:10, color:'var(--t3)' }}>{r.option_value}</div>}
                            <div style={{ fontSize:11, fontWeight:800, color:'var(--amber)', marginTop:2 }}>{fmt(toN(r.확정수량))}개 · {fmt(toN(r.확정수량)*(r.cost||0))}원</div>
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

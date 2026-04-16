'use client'
import { useState, useEffect, useMemo } from 'react'

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI'

type SupplyRow = {
  발주번호: number
  'SKU ID': number
  'SKU 이름': string
  'SKU Barcode': string
  물류센터: string
  입고예정일: string
  발주일: string
  발주수량: number
  확정수량: number
  입고수량: number
  image_url?: string
  cost?: number
}

function toD(s: string) { return s ? s.slice(0, 10) : '' }
function toN(v: unknown) { return Number(v) || 0 }

export default function SupplyPage() {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const today = new Date().toISOString().slice(0, 10)

  const [rows, setRows] = useState<SupplyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('2026-01-01')
  const [dateTo, setDateTo] = useState(today)
  const [search, setSearch] = useState('')

  // 주간 금~목 계산
  const weekRange = useMemo(() => {
    const d = new Date(), dow = d.getDay()
    const lastThu = new Date(d); lastThu.setDate(d.getDate() - ((dow + 3) % 7 + 1))
    const lastFri = new Date(lastThu); lastFri.setDate(lastThu.getDate() - 6)
    return { from: lastFri.toISOString().slice(0,10), to: lastThu.toISOString().slice(0,10) }
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      // supply_status + products(cost, image) JOIN
      const r = await fetch(`${SUPA_URL}/rest/v1/supply_status?select=*&order=입고예정일.asc&limit=5000`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
      })
      const data: SupplyRow[] = await r.json()

      // products에서 barcode → cost, image_url 매핑
      const barcodes = [...new Set(data.map(r => r['SKU Barcode']).filter(Boolean))]
      const costMap: Record<string, { cost: number; image_url: string }> = {}
      for (let i = 0; i < barcodes.length; i += 200) {
        const batch = barcodes.slice(i, i + 200)
        const pr = await fetch(`${SUPA_URL}/rest/v1/products?select=barcode,cost,image_url&barcode=in.(${batch.map(b => `"${b}"`).join(',')})`, {
          headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
        })
        const pdata: { barcode: string; cost: number; image_url: string }[] = await pr.json()
        pdata.forEach(p => { costMap[p.barcode] = { cost: p.cost, image_url: p.image_url } })
      }

      const enriched = data.map(r => ({
        ...r,
        발주수량: toN(r.발주수량),
        확정수량: toN(r.확정수량),
        입고수량: toN(r.입고수량),
        cost: costMap[r['SKU Barcode']]?.cost || 0,
        image_url: costMap[r['SKU Barcode']]?.image_url || '',
      }))
      setRows(enriched)
      setLoading(false)
    }
    load()
  }, [])

  // 필터된 공급 리스트
  const filtered = useMemo(() => {
    return rows.filter(r => {
      const d = toD(r.입고예정일)
      const inDate = d >= dateFrom && d <= dateTo
      const inSearch = !search || r['SKU 이름'].includes(search)
      return inDate && inSearch
    })
  }, [rows, dateFrom, dateTo, search])

  // 카드 계산 헬퍼
  function calcKpi(rowSet: SupplyRow[]) {
    const qty = rowSet.reduce((s, r) => s + r.확정수량, 0)
    const amt = rowSet.reduce((s, r) => s + r.확정수량 * r.cost!, 0)
    return { qty, amt }
  }

  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0,10)
  const yearStr = '2026-01-01'

  const kpiYest = useMemo(() => calcKpi(rows.filter(r => toD(r.입고예정일) === yesterdayStr)), [rows])
  const kpiWeek = useMemo(() => calcKpi(rows.filter(r => { const d=toD(r.입고예정일); return d>=weekRange.from&&d<=weekRange.to })), [rows])
  const kpiCum = useMemo(() => calcKpi(rows.filter(r => toD(r.입고예정일) >= yearStr)), [rows])
  const kpiMoving = useMemo(() => calcKpi(rows.filter(r => toD(r.입고예정일) >= today && toN(r.입고수량) === 0)), [rows])

  // 미납 리스트: 입고수량 < 확정수량
  const unpaid = useMemo(() => filtered.filter(r => r.입고수량 < r.확정수량), [filtered])

  // 이동중 파이프라인: 입고예정일 >= 오늘 && 입고수량 = 0
  const moving = useMemo(() => {
    const mv = rows.filter(r => toD(r.입고예정일) >= today && toN(r.입고수량) === 0)
    // 일별 그룹
    const byDate: Record<string, SupplyRow[]> = {}
    mv.forEach(r => {
      const d = toD(r.입고예정일)
      if (!byDate[d]) byDate[d] = []
      byDate[d].push(r)
    })
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
  }, [rows])

  const kpiCards = [
    { label: '전일 공급량', sub: yesterdayStr, qty: kpiYest.qty, amt: kpiYest.amt, color: 'var(--blue)', ico: '📦' },
    { label: '주간 공급량', sub: `${weekRange.from.slice(5)}~${weekRange.to.slice(5)} (금~목)`, qty: kpiWeek.qty, amt: kpiWeek.amt, color: 'var(--purple)', ico: '📅' },
    { label: '누적 공급량', sub: '26년 1/1~오늘', qty: kpiCum.qty, amt: kpiCum.amt, color: 'var(--green)', ico: '📊' },
    { label: '이동중', sub: '오늘 이후 미입고', qty: kpiMoving.qty, amt: kpiMoving.amt, color: 'var(--amber)', ico: '🚢' },
  ]

  return (
    <div>
      {/* KPI 카드 */}
      <div className="krow" style={{ marginBottom: 16 }}>
        {kpiCards.map((c, i) => (
          <div key={i} className={`kpi kc-${['bl','pu','gr','am'][i]}`}>
            <div className="kpi-top"><div className="kpi-ico">{c.ico}</div></div>
            <div className="kpi-lbl">{c.label}</div>
            <div className="kpi-val" style={{ color: c.color }}>{fmt(c.qty)}</div>
            <div className="kpi-foot">{fmt(c.amt)}원</div>
            <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 공급 현황 리스트 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">🚚</div><div><div className="ch-title">공급 현황</div><div className="ch-sub">발주 · 공급 · 입고 현황</div></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
            <input className="si" placeholder="🔍 상품명 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 150 }} />
          </div>
        </div>
        <div className="cb">
          {loading ? <div className="empty-st"><div className="es-ico">🚚</div><div className="es-t">로딩 중...</div></div> : (
            <div className="tw" style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 900 }}>
                <thead><tr>
                  <th>공급예정일</th><th>상품명</th><th>옵션</th>
                  <th style={{ textAlign: 'right' }}>발주수량</th>
                  <th style={{ textAlign: 'right' }}>공급수량</th>
                  <th style={{ textAlign: 'right' }}>입고수량</th>
                  <th style={{ textAlign: 'right' }}>미납수량</th>
                  <th style={{ textAlign: 'right' }}>공급률</th>
                  <th style={{ textAlign: 'right' }}>발주금액</th>
                  <th style={{ textAlign: 'right' }}>공급금액</th>
                  <th style={{ textAlign: 'right' }}>입고금액</th>
                  <th style={{ textAlign: 'right' }}>미납금액</th>
                </tr></thead>
                <tbody>
                  {filtered.length > 0 ? filtered.map((r, i) => {
                    const unpaidQty = r.확정수량 - r.입고수량
                    const rate = r.확정수량 > 0 ? Math.round(r.입고수량 / r.확정수량 * 100) : 0
                    const cost = r.cost || 0
                    const name = r['SKU 이름'] || ''
                    const barcode = r['SKU Barcode'] || ''
                    // 상품명 = - 앞부분, 옵션 = 나머지
                    const dashIdx = name.lastIndexOf(' ')
                    const prodName = name
                    return (
                      <tr key={i}>
                        <td style={{ fontSize: 11 }}>{toD(r.입고예정일)}</td>
                        <td style={{ fontWeight: 700, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prodName}</td>
                        <td style={{ fontSize: 11, color: 'var(--t3)' }}>{barcode}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.발주수량)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--blue)' }}>{fmt(r.확정수량)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmt(r.입고수량)}</td>
                        <td style={{ textAlign: 'right', color: unpaidQty > 0 ? 'var(--red, #ef4444)' : 'var(--t3)' }}>{fmt(unpaidQty)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: rate >= 100 ? 'var(--green)' : rate >= 50 ? 'var(--amber)' : 'var(--red, #ef4444)' }}>{rate}%</span>
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{fmt(r.발주수량 * cost)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--blue)' }}>{fmt(r.확정수량 * cost)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--green)' }}>{fmt(r.입고수량 * cost)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11, color: unpaidQty > 0 ? 'var(--red, #ef4444)' : 'var(--t3)' }}>{fmt(unpaidQty * cost)}</td>
                      </tr>
                    )
                  }) : <tr><td colSpan={12}><div className="empty-st"><div className="es-ico">🚚</div><div className="es-t">데이터 없음</div></div></td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 미납 리스트 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch"><div className="ch-l"><div className="ch-ico">⚠️</div><div><div className="ch-title">미납 리스트</div><div className="ch-sub">입고수량 &lt; 확정수량</div></div></div></div>
        <div className="cb">
          <div className="tw" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 900 }}>
              <thead><tr>
                <th>공급예정일</th><th style={{ width: 36 }}>이미지</th><th>상품명</th><th>옵션</th>
                <th style={{ textAlign: 'right' }}>발주</th><th style={{ textAlign: 'right' }}>공급</th>
                <th style={{ textAlign: 'right' }}>입고</th><th style={{ textAlign: 'right' }}>미납</th>
                <th style={{ textAlign: 'right' }}>공급률</th>
                <th style={{ textAlign: 'right' }}>발주금액</th><th style={{ textAlign: 'right' }}>공급금액</th>
                <th style={{ textAlign: 'right' }}>입고금액</th><th style={{ textAlign: 'right' }}>미납금액</th>
              </tr></thead>
              <tbody>
                {unpaid.length > 0 ? unpaid.map((r, i) => {
                  const unpaidQty = r.확정수량 - r.입고수량
                  const rate = r.확정수량 > 0 ? Math.round(r.입고수량 / r.확정수량 * 100) : 0
                  const cost = r.cost || 0
                  return (
                    <tr key={i}>
                      <td style={{ fontSize: 11 }}>{toD(r.입고예정일)}</td>
                      <td>
                        {r.image_url
                          ? <img src={r.image_url} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          : <div style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>-</div>}
                      </td>
                      <td style={{ fontWeight: 700, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r['SKU 이름']}</td>
                      <td style={{ fontSize: 11, color: 'var(--t3)' }}>{r['SKU Barcode']}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.발주수량)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--blue)' }}>{fmt(r.확정수량)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmt(r.입고수량)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red, #ef4444)' }}>{fmt(unpaidQty)}</td>
                      <td style={{ textAlign: 'right' }}><span style={{ fontSize: 10, fontWeight: 700, color: rate >= 100 ? 'var(--green)' : rate >= 50 ? 'var(--amber)' : 'var(--red, #ef4444)' }}>{rate}%</span></td>
                      <td style={{ textAlign: 'right', fontSize: 11 }}>{fmt(r.발주수량 * cost)}</td>
                      <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--blue)' }}>{fmt(r.확정수량 * cost)}</td>
                      <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--green)' }}>{fmt(r.입고수량 * cost)}</td>
                      <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--red, #ef4444)' }}>{fmt(unpaidQty * cost)}</td>
                    </tr>
                  )
                }) : <tr><td colSpan={13}><div className="empty-st"><div className="es-ico">✅</div><div className="es-t">미납 없음</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 이동중 파이프라인 */}
      <div className="card">
        <div className="ch"><div className="ch-l"><div className="ch-ico">🚢</div><div>
          <div className="ch-title">이동중 파이프라인</div>
          <div className="ch-sub">오늘 이후 입고예정 · 미입고 상품</div>
        </div></div>
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700 }}>
            총 {fmt(kpiMoving.qty)}개 · {fmt(kpiMoving.amt)}원
          </div>
        </div>
        <div className="cb">
          {moving.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {moving.map(([date, items]) => {
                const dayQty = items.reduce((s, r) => s + r.확정수량, 0)
                const dayAmt = items.reduce((s, r) => s + r.확정수량 * (r.cost || 0), 0)
                return (
                  <div key={date} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ background: 'var(--bg)', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>📅 {date}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)' }}>{items.length}개 품목 · {fmt(dayQty)}개 · {fmt(dayAmt)}원</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, padding: 12 }}>
                      {items.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
                          {r.image_url
                            ? <img src={r.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>📦</div>}
                          <div style={{ overflow: 'hidden', flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r['SKU 이름']}</div>
                            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>{r['SKU Barcode']}</div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--amber)', marginTop: 2 }}>
                              {fmt(r.확정수량)}개 · {fmt(r.확정수량 * (r.cost || 0))}원
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <div className="empty-st"><div className="es-ico">🚢</div><div className="es-t">이동중 상품 없음</div></div>}
        </div>
      </div>
    </div>
  )
}

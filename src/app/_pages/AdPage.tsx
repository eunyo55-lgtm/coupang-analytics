'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import { filterByRange, toYMD } from '@/lib/dateUtils'
import { Chart, registerables } from 'chart.js'
import type { AdEntry } from '@/types'
import CoupangAdUpload from '@/components/CoupangAdUpload'
import AdSignalCards from '@/components/AdSignalCards'
import AdPerformanceCharts from '@/components/AdPerformanceCharts'
import AdBreakdownTables from '@/components/AdBreakdownTables'

Chart.register(...registerables)

const today = new Date()
today.setHours(0, 0, 0, 0)

export default function AdPage() {
  const { state, dispatch } = useApp()
  const { dateRange } = state
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  const [name,    setName]    = useState('')
  const [cost,    setCost]    = useState('')
  const [rev,     setRev]     = useState('')
  const [clicks,  setClicks]  = useState('')
  const [imps,    setImps]    = useState('')
  const [saving,  setSaving]  = useState(false)

  const adChartRef  = useRef<HTMLCanvasElement>(null)
  const adChartInst = useRef<Chart | null>(null)

  // 쿠팡 광고 CSV 업로드분 (coupang_ad_daily) — 전체 일별 합계 로드 후 dateRange로 필터
  type AdDaily = { date: string; ad_cost: number; revenue_14d: number; revenue_1d: number; impressions: number; clicks: number }
  const [csvDailyAll, setCsvDailyAll] = useState<AdDaily[]>([])

  // Load from Supabase
  useEffect(() => { loadAds() }, [dateRange]) // eslint-disable-line
  useEffect(() => { loadCsvDaily() }, []) // CSV 전체는 한 번만 로드

  async function loadCsvDaily() {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('coupang_ad_daily_summary')
        .select('date, ad_cost, revenue_14d, revenue_1d, impressions, clicks')
        .order('date', { ascending: true })
      if (error) { console.warn('[AdPage] coupang_ad_daily_summary load error:', error.message); return }
      setCsvDailyAll((data as AdDaily[]) || [])
    } catch (e) { console.warn('[AdPage] csv daily load:', e) }
  }

  // dateRange로 필터한 CSV 데이터
  const csvDaily = csvDailyAll.filter(r => {
    const d = r.date
    return d >= toYMD(dateRange.from) && d <= toYMD(dateRange.to)
  })
  const csvOutOfRange = csvDailyAll.length - csvDaily.length
  const dbMinDate = csvDailyAll[0]?.date
  const dbMaxDate = csvDailyAll[csvDailyAll.length - 1]?.date

  async function loadAds() {
    try {
      const { data } = await supabase
        .from('ad_entries')
        .select('*')
        .gte('date', toYMD(dateRange.from))
        .lte('date', toYMD(dateRange.to))
        .order('date', { ascending: false })
      if (data) {
        dispatch({
          type: 'SET_AD_ENTRIES',
          payload: (data as any[]).map((r: any) => ({
            id: r.id, productName: r.product_name,
            adCost: r.ad_cost, adRevenue: r.ad_revenue,
            clicks: r.clicks,  impressions: r.impressions,
            date: r.date,
          })),
        })
      }
    } catch { /* offline */ }
  }

  async function addEntry() {
    if (!name) return
    const entry: AdEntry = {
      productName: name,
      adCost:      parseFloat(cost)   || 0,
      adRevenue:   parseFloat(rev)    || 0,
      clicks:      parseInt(clicks)   || 0,
      impressions: parseInt(imps)     || 0,
      date: toYMD(today),
    }
    setSaving(true)
    try {
      const { data } = await supabase.from('ad_entries').insert({
        product_name: entry.productName, ad_cost: entry.adCost,
        ad_revenue:   entry.adRevenue,   clicks:  entry.clicks,
        impressions:  entry.impressions, date:    entry.date,
      }).select().single()
      if (data) entry.id = data.id
    } catch { /* offline */ }
    setSaving(false)
    dispatch({ type: 'ADD_AD_ENTRY', payload: entry })
    setName(''); setCost(''); setRev(''); setClicks(''); setImps('')
  }

  const filtered = filterByRange(state.adEntries, dateRange)
  // 수동 입력 합산
  const manualCost = filtered.reduce((s, a) => s + a.adCost, 0)
  const manualRev  = filtered.reduce((s, a) => s + a.adRevenue, 0)
  // CSV 업로드 합산 (14일 매출 기준 — 쿠팡 광고 콘솔 기본)
  const csvCost = csvDaily.reduce((s, r) => s + Number(r.ad_cost || 0), 0)
  const csvRev  = csvDaily.reduce((s, r) => s + Number(r.revenue_14d || 0), 0)
  // 두 소스 합산 (중복은 사용자가 정리)
  const totalCost = manualCost + csvCost
  const totalRev  = manualRev + csvRev
  const roas      = totalCost ? (totalRev / totalCost).toFixed(2) : '0'
  const acos      = totalRev  ? (totalCost / totalRev * 100).toFixed(1) + '%' : '0%'

  // Build bar chart
  useEffect(() => {
    if (!adChartRef.current || !filtered.length) return
    adChartInst.current?.destroy()
    adChartInst.current = new Chart(adChartRef.current, {
      type: 'bar',
      data: {
        labels: filtered.map(a => a.productName.substring(0, 8)),
        datasets: [
          { label: 'ROAS', data: filtered.map(a => a.adCost ? +(a.adRevenue / a.adCost).toFixed(2) : 0), backgroundColor: '#DBEAFE', borderColor: '#1570EF', borderWidth: 1.5, borderRadius: 4, yAxisID: 'y' },
          { label: 'ACoS %', data: filtered.map(a => a.adRevenue ? +(a.adCost / a.adRevenue * 100).toFixed(1) : 0), backgroundColor: '#FEE2E2', borderColor: '#F04438', borderWidth: 1.5, borderRadius: 4, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x:  { ticks: { color: '#9BA5B4', font: { size: 10, weight: 'bold' } }, grid: { color: 'rgba(0,0,0,.03)' } },
          y:  { ticks: { color: '#9BA5B4', font: { size: 10, weight: 'bold' } }, grid: { color: 'rgba(0,0,0,.03)' } },
          y1: { position: 'right', ticks: { color: '#9BA5B4', font: { size: 10, weight: 'bold' }, callback: (v) => v + '%' }, grid: { display: false } },
        },
      },
    })
    return () => { adChartInst.current?.destroy() }
  }, [filtered])

  // CSV 데이터의 max 날짜 기준으로 dateRange 조정 (한 번 클릭으로)
  function applyAdDataRange() {
    if (!dbMinDate || !dbMaxDate) return
    dispatch({
      type: 'SET_DATE_RANGE',
      payload: {
        from: new Date(dbMinDate + 'T00:00:00'),
        to:   new Date(dbMaxDate + 'T00:00:00'),
        label: `광고 데이터 ${dbMinDate} ~ ${dbMaxDate}`,
        preset: 'custom',
      },
    })
  }

  return (
    <div>
      {/* 광고 리포트 CSV 업로드 (쿠팡 광고 어드민 → 리포트 다운로드) */}
      <CoupangAdUpload onComplete={loadCsvDaily} />

      {/* dateRange 외부에 광고 데이터가 있으면 안내 */}
      {csvDailyAll.length > 0 && csvDaily.length === 0 && (
        <div
          style={{
            background: '#fef3c7', border: '1px solid #fcd34d',
            padding: '12px 14px', borderRadius: 8, marginBottom: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 13, color: '#78350f' }}>
            ⚠️ 업로드된 광고 데이터 <b>{csvDailyAll.length}일치</b>가 현재 표시 기간 외부에 있어 KPI에 반영되지 않았습니다.
            DB 데이터 범위: <b>{dbMinDate} ~ {dbMaxDate}</b>
          </div>
          <button
            onClick={applyAdDataRange}
            style={{
              padding: '6px 14px', background: '#f59e0b', color: 'white', border: 'none',
              borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            🎯 해당 기간으로 보기
          </button>
        </div>
      )}
      {csvDailyAll.length > 0 && csvDaily.length > 0 && csvOutOfRange > 0 && (
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          광고 데이터 표시 중: {csvDaily.length}일 / DB 전체 {csvDailyAll.length}일 ({csvOutOfRange}일은 현재 기간 밖)
        </div>
      )}

      <div className="krow">
        <div className="kpi kc-re">
          <div className="kpi-top"><div className="kpi-ico">💸</div><div className="kpi-badge kb-dn">비용</div></div>
          <div className="kpi-lbl">총 광고비</div>
          <div className="kpi-val">{fmt(totalCost)}</div>
          <div className="kpi-foot">기간 합계{csvDaily.length > 0 ? ` · CSV ${csvDaily.length}일` : ''}</div>
        </div>
        <div className="kpi kc-gr">
          <div className="kpi-top"><div className="kpi-ico">📣</div><div className="kpi-badge kb-up">▲</div></div>
          <div className="kpi-lbl">광고 매출</div>
          <div className="kpi-val">{fmt(totalRev)}</div>
          <div className="kpi-foot">기여 매출</div>
        </div>
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">📈</div></div>
          <div className="kpi-lbl">ROAS</div>
          <div className="kpi-val">{roas}</div>
          <div className="kpi-foot">매출/광고비</div>
        </div>
        <div className="kpi kc-am">
          <div className="kpi-top"><div className="kpi-ico">🎯</div></div>
          <div className="kpi-lbl">ACoS</div>
          <div className="kpi-val">{acos}</div>
          <div className="kpi-foot">광고비/매출</div>
        </div>
      </div>

      {/* 🚨 광고 신호 자동 탐지 (ROAS 미달 / 광고비 급증 / CTR 급락 / 신규 키워드 기회) */}
      <AdSignalCards dateFrom={toYMD(dateRange.from)} dateTo={toYMD(dateRange.to)} />

      {/* 📈 일별 추이 + 주간 집계 */}
      <AdPerformanceCharts dateFrom={toYMD(dateRange.from)} dateTo={toYMD(dateRange.to)} />

      {/* 🧮 캠페인/상품/키워드/노출지면 차원별 성과 */}
      <AdBreakdownTables dateFrom={toYMD(dateRange.from)} dateTo={toYMD(dateRange.to)} />

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">➕</div><div>
            <div className="ch-title">광고 데이터 입력</div>
            <div className="ch-sub">{dateRange.label} · 쿠팡 광고 어드민 기준 (수동 입력)</div>
          </div></div>
        </div>
        <div className="cb">
          <div className="fgrid">
            <div className="fcol" style={{ gridColumn: 'span 2' }}>
              <label className="fl">📦 상품명</label>
              <input className="fi" value={name} onChange={e => setName(e.target.value)} placeholder="광고 상품명" />
            </div>
            <div className="fcol"><label className="fl">💸 광고비</label><input className="fi" type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="0" /></div>
            <div className="fcol"><label className="fl">💰 광고 매출</label><input className="fi" type="number" value={rev} onChange={e => setRev(e.target.value)} placeholder="0" /></div>
            <div className="fcol"><label className="fl">👆 클릭수</label><input className="fi" type="number" value={clicks} onChange={e => setClicks(e.target.value)} placeholder="0" /></div>
            <div className="fcol"><label className="fl">👀 노출수</label><input className="fi" type="number" value={imps} onChange={e => setImps(e.target.value)} placeholder="0" /></div>
            <div className="fcol" style={{ justifyContent: 'flex-end' }}>
              <button className="btn-p" onClick={addEntry} disabled={saving} style={{ marginTop: 18 }}>
                {saving ? '저장 중...' : '➕ 추가'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="g2">
        <div className="card">
          <div className="ch"><div className="ch-l"><div className="ch-ico">📊</div><div className="ch-title">광고 성과 테이블</div></div></div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw">
              <table>
                <thead><tr><th>상품</th><th>광고비</th><th>매출</th><th>ROAS</th><th>ACoS</th><th>CTR</th><th></th></tr></thead>
                <tbody>
                  {filtered.length > 0 ? filtered.map((a, i) => {
                    const r = a.adCost ? (a.adRevenue / a.adCost).toFixed(2) : '0'
                    const ac = a.adRevenue ? (a.adCost / a.adRevenue * 100).toFixed(1) + '%' : '0%'
                    const ctr = a.impressions ? (a.clicks / a.impressions * 100).toFixed(2) + '%' : '0%'
                    const rc = parseFloat(r) >= 3 ? 'var(--green)' : parseFloat(r) >= 1 ? 'var(--amber)' : 'var(--red)'
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 700 }}>{a.productName}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(a.adCost)}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(a.adRevenue)}</td>
                        <td style={{ fontWeight: 800, color: rc }}>{r}</td>
                        <td style={{ fontWeight: 700 }}>{ac}</td>
                        <td style={{ fontWeight: 700 }}>{ctr}</td>
                        <td>
                          <button onClick={() => dispatch({ type: 'DELETE_AD_ENTRY', payload: state.adEntries.indexOf(a) })}
                            style={{ background: 'none', border: '1px solid #FECACA', borderRadius: 5, color: 'var(--red)', fontSize: 11, fontWeight: 700, padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                            삭제
                          </button>
                        </td>
                      </tr>
                    )
                  }) : (
                    <tr><td colSpan={7}><div className="empty-st"><div className="es-ico">📣</div><div className="es-t">광고 데이터를 입력해주세요</div></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="ch"><div className="ch-l"><div className="ch-ico">📉</div><div className="ch-title">ROAS · ACoS 비교</div></div></div>
          <div className="cb">
            {filtered.length > 0
              ? <div style={{ position: 'relative', height: 200 }}><canvas ref={adChartRef} role="img" aria-label="광고 ROAS ACoS 비교 차트" /></div>
              : <div className="empty-st"><div className="es-ico">📉</div><div className="es-t">광고 데이터를 입력하면 차트가 표시됩니다</div></div>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

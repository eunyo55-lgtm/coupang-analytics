'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import { filterByRange, toYMD } from '@/lib/dateUtils'
import { Chart, registerables } from 'chart.js'
import type { AdEntry } from '@/types'

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

  // Load from Supabase
  useEffect(() => { loadAds() }, [dateRange]) // eslint-disable-line

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
  const totalCost = filtered.reduce((s, a) => s + a.adCost, 0)
  const totalRev  = filtered.reduce((s, a) => s + a.adRevenue, 0)
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

  return (
    <div>
      <div className="krow">
        <div className="kpi kc-re">
          <div className="kpi-top"><div className="kpi-ico">💸</div><div className="kpi-badge kb-dn">비용</div></div>
          <div className="kpi-lbl">총 광고비</div>
          <div className="kpi-val">{fmt(totalCost)}</div>
          <div className="kpi-foot">기간 합계</div>
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

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">➕</div><div>
            <div className="ch-title">광고 데이터 입력</div>
            <div className="ch-sub">{dateRange.label} · 쿠팡 광고 어드민 기준</div>
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

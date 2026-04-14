'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/store'
import { useAnalytics } from '@/hooks/useAnalytics'
import SalesLineChart from '@/components/charts/SalesLineChart'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

export default function SalesPage() {
  const { state } = useApp()
  const { totals, dailySales, salesByProduct } = useAnalytics()
  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState('rev')
  const pieRef  = useRef<HTMLCanvasElement>(null)
  const pieChart = useRef<Chart | null>(null)
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  // Pie chart
  useEffect(() => {
    if (!pieRef.current || !salesByProduct.length) return
    pieChart.current?.destroy()
    const top = salesByProduct.slice(0, 6)
    pieChart.current = new Chart(pieRef.current, {
      type: 'doughnut',
      data: {
        labels: top.map(i => i.name.substring(0, 10)),
        datasets: [{
          data: top.map(i => Math.round(i.revenue)),
          backgroundColor: ['#1570EF','#12B76A','#F79009','#F04438','#7F56D9','#0BA5EC'],
          borderWidth: 3,
          borderColor: '#fff',
          hoverOffset: 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'bottom', labels: { font: { size: 10, weight: 'bold' }, color: '#56606E', boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: ctx => ' ' + Number(ctx.parsed).toLocaleString('ko-KR') } },
        },
      },
    })
    return () => { pieChart.current?.destroy() }
  }, [salesByProduct])

  const filtered = salesByProduct
    .filter(i => !search || (i.name + i.option).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'qty' ? b.qty - a.qty : sort === 'name' ? a.name.localeCompare(b.name) : b.revenue - a.revenue)

  const totalRev = totals.revenue || 1

  return (
    <div>
      {/* KPI */}
      <div className="krow">
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">💰</div><div className="kpi-badge kb-up">▲</div></div>
          <div className="kpi-lbl">총 매출</div>
          <div className="kpi-val">{fmt(totals.revenue)}</div>
          <div className="kpi-foot">기간 합계</div>
        </div>
        <div className="kpi kc-gr">
          <div className="kpi-top"><div className="kpi-ico">🛍️</div></div>
          <div className="kpi-lbl">판매량</div>
          <div className="kpi-val">{fmt(totals.qty)}</div>
          <div className="kpi-foot">건</div>
        </div>
        <div className="kpi kc-pu">
          <div className="kpi-top"><div className="kpi-ico">🏷️</div></div>
          <div className="kpi-lbl">판매 SKU</div>
          <div className="kpi-val">{totals.skuCount}</div>
          <div className="kpi-foot">종</div>
        </div>
        <div className="kpi kc-te">
          <div className="kpi-top"><div className="kpi-ico">💳</div></div>
          <div className="kpi-lbl">평균 단가</div>
          <div className="kpi-val">{fmt(totals.avgPrice)}</div>
          <div className="kpi-foot">건당</div>
        </div>
        <div className="kpi kc-re">
          <div className="kpi-top"><div className="kpi-ico">↩️</div><div className="kpi-badge kb-dn">주의</div></div>
          <div className="kpi-lbl">반품·취소</div>
          <div className="kpi-val">{fmt(totals.returns)}</div>
          <div className="kpi-foot">건</div>
        </div>
      </div>

      {/* 차트 2개 */}
      <div className="g2">
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">📈</div><div>
              <div className="ch-title">일별 판매 추이</div>
              <div className="ch-sub">{state.dateRange.label}</div>
            </div></div>
          </div>
          <div className="cb">
            {dailySales.length > 0
              ? <SalesLineChart data={dailySales} height={230} />
              : <div className="empty-st"><div className="es-ico">📈</div><div className="es-t">판매 데이터를 업로드해주세요</div></div>
            }
          </div>
        </div>
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🍩</div><div className="ch-title">상품별 매출 비중</div></div>
          </div>
          <div className="cb">
            {salesByProduct.length > 0
              ? <div style={{ position: 'relative', height: 230 }}><canvas ref={pieRef} role="img" aria-label="상품별 매출 비중 도넛 차트" /></div>
              : <div className="empty-st"><div className="es-ico">🍩</div><div className="es-t">판매 데이터를 업로드해주세요</div></div>
            }
          </div>
        </div>
      </div>

      {/* 상세 테이블 */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📝</div><div className="ch-title">상품별 판매 상세</div></div>
        </div>
        <div className="cb">
          <div className="frow">
            <input className="si" placeholder="🔍 상품명 · 옵션 검색..." value={search} onChange={e => setSearch(e.target.value)} />
            <select className="sel" value={sort} onChange={e => setSort(e.target.value)}>
              <option value="rev">매출 순</option>
              <option value="qty">판매량 순</option>
              <option value="name">이름 순</option>
            </select>
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr><th>#</th><th>상품명</th><th>옵션</th><th>판매량</th><th>매출</th><th>비중</th></tr>
              </thead>
              <tbody>
                {filtered.length > 0 ? filtered.slice(0, 50).map((item, i) => {
                  const pct = item.revenue / totalRev * 100
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 800, color: 'var(--t3)', fontSize: 11 }}>{i + 1}</td>
                      <td style={{ fontWeight: 700, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
                      <td style={{ color: 'var(--t3)', fontSize: 11 }}>{item.option || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(item.qty)}</td>
                      <td style={{ fontWeight: 800, color: 'var(--blue)' }}>{fmt(item.revenue)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="bar" style={{ width: 52 }}><div className="barf" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)' }}>{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={6}><div className="empty-st"><div className="es-ico">🛒</div><div className="es-t">{state.salesData.length ? '검색 결과 없음' : '판매 데이터를 업로드해주세요'}</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

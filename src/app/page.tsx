'use client'

import { useApp } from '@/lib/store'
import { useAnalytics } from '@/hooks/useAnalytics'
import { filterByRange, toYMD } from '@/lib/dateUtils'
import SalesLineChart from '@/components/charts/SalesLineChart'

export default function DashboardPage() {
  const { state } = useApp()
  const { dateRange } = state
  const { totals, dailySales, inventory, salesByProduct } = useAnalytics()

  // Previous period comparison
  const days = Math.max(
    Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    1
  )
  const prevEnd   = new Date(dateRange.from); prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd);        prevStart.setDate(prevStart.getDate() - days + 1)
  const prevSales = filterByRange(
    state.salesData.filter(r => !r.isReturn),
    { from: prevStart, to: prevEnd, label: '', preset: '' }
  )
  const prevRev = prevSales.reduce((s, r) => s + r.revenue, 0) || 1
  const prevQty = prevSales.reduce((s, r) => s + r.qty, 0)     || 1
  const revDiff = Math.round((totals.revenue - prevRev) / prevRev * 100)
  const qtyDiff = Math.round((totals.qty     - prevQty) / prevQty * 100)

  const dangerItems = inventory.filter(i => i.status === 'danger').slice(0, 5)
  const warnItems   = inventory.filter(i => i.status === 'warn').slice(0, 3)
  const topItems    = [...salesByProduct].slice(0, 5)
  const supplyCount = state.supplyData.length

  const adEntries = filterByRange(state.adEntries, dateRange)
  const adCost    = adEntries.reduce((s, a) => s + a.adCost, 0)
  const adRev     = adEntries.reduce((s, a) => s + a.adRevenue, 0)
  const roas      = adCost ? (adRev / adCost).toFixed(1) : '—'
  const acos      = adRev  ? (adCost / adRev * 100).toFixed(1) + '%' : '—'

  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  return (
    <div>
      {/* KPI 4종 */}
      <div className="ds-row">
        <div className="ds-card ds-c1">
          <div className="ds-lbl">🛒 판매량</div>
          <div className="ds-val">{fmt(totals.qty)}</div>
          <div className="ds-cmp">
            <span className="ds-sub">전기 대비</span>
            <span className={qtyDiff >= 0 ? 'diff-up' : 'diff-dn'}>
              {qtyDiff >= 0 ? '▲' : '▼'} {Math.abs(qtyDiff)}%
            </span>
          </div>
        </div>
        <div className="ds-card ds-c2">
          <div className="ds-lbl">💰 매출액</div>
          <div className="ds-val">{fmt(totals.revenue)}</div>
          <div className="ds-cmp">
            <span className="ds-sub">전기 대비</span>
            <span className={revDiff >= 0 ? 'diff-up' : 'diff-dn'}>
              {revDiff >= 0 ? '▲' : '▼'} {Math.abs(revDiff)}%
            </span>
          </div>
        </div>
        <div className="ds-card ds-c3">
          <div className="ds-lbl">📦 재고 위험 품목</div>
          <div className="ds-val">{dangerItems.length + warnItems.length}</div>
          <div className="ds-cmp">
            <span className="ds-sub">긴급</span>
            <span className="diff-dn">{dangerItems.length}개</span>
          </div>
        </div>
        <div className="ds-card ds-c4">
          <div className="ds-lbl">🚚 공급 중</div>
          <div className="ds-val">{fmt(supplyCount)}</div>
          <div className="ds-cmp">
            <span className="ds-sub">입고 대기</span>
            <span className="diff-nt">{supplyCount}개 품목</span>
          </div>
        </div>
      </div>

      {/* 판매 추이 + 재고 소진 */}
      <div className="g2">
        <div className="card">
          <div className="ch">
            <div className="ch-l">
              <div className="ch-ico">📈</div>
              <div>
                <div className="ch-title">판매 추이</div>
                <div className="ch-sub">{dateRange.label}</div>
              </div>
            </div>
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
            <div className="ch-l">
              <div className="ch-ico">📦</div>
              <div>
                <div className="ch-title">재고 소진 예상</div>
                <div className="ch-sub">위험 품목 우선</div>
              </div>
            </div>
            <a href="/inventory" className="btn-g" style={{ textDecoration: 'none', fontSize: 11, padding: '5px 10px' }}>전체 →</a>
          </div>
          <div className="cb" style={{ padding: '8px 14px' }}>
            {inventory.length > 0 ? (
              <div className="tw">
                <table>
                  <thead><tr><th>상품명</th><th>재고</th><th>소진예상</th><th>상태</th></tr></thead>
                  <tbody>
                    {[...dangerItems, ...warnItems].slice(0, 5).map((item, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 700, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(item.stock)}</td>
                        <td style={{ fontWeight: 800, color: item.status === 'danger' ? 'var(--red)' : 'var(--amber)' }}>
                          {item.daysLeft >= 999 ? '충분' : `${item.daysLeft}일`}
                        </td>
                        <td>
                          {item.status === 'danger'
                            ? <span className="badge b-re">🚨 긴급</span>
                            : <span className="badge b-am">⚠️ 주의</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-st"><div className="es-ico">📦</div><div className="es-t">데이터를 업로드해주세요</div></div>
            )}
          </div>
        </div>
      </div>

      {/* TOP5 + 광고 요약 */}
      <div className="g2">
        <div className="card">
          <div className="ch">
            <div className="ch-l">
              <div className="ch-ico">🥇</div>
              <div>
                <div className="ch-title">판매 TOP 5</div>
                <div className="ch-sub">{dateRange.label}</div>
              </div>
            </div>
            <a href="/sales" className="btn-g" style={{ textDecoration: 'none', fontSize: 11, padding: '5px 10px' }}>전체 →</a>
          </div>
          <div className="cb" style={{ padding: '8px 14px' }}>
            {topItems.length > 0 ? (
              <div className="tw">
                <table>
                  <thead><tr><th>#</th><th>상품명</th><th>판매량</th><th>매출</th></tr></thead>
                  <tbody>
                    {topItems.map((item, i) => (
                      <tr key={i}>
                        <td><span className={`rank-medal ${['rm1','rm2','rm3','rmn','rmn'][i]}`}>{i + 1}</span></td>
                        <td style={{ fontWeight: 700, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(item.qty)}</td>
                        <td style={{ fontWeight: 800, color: 'var(--blue)' }}>{fmt(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-st"><div className="es-ico">🥇</div><div className="es-t">판매 데이터를 업로드해주세요</div></div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="ch">
            <div className="ch-l">
              <div className="ch-ico">📣</div>
              <div>
                <div className="ch-title">광고 요약</div>
                <div className="ch-sub">{dateRange.label}</div>
              </div>
            </div>
            <a href="/ad" className="btn-g" style={{ textDecoration: 'none', fontSize: 11, padding: '5px 10px' }}>상세 →</a>
          </div>
          <div className="cb">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'ROAS',   value: roas,            color: 'var(--green)', note: '목표 3.5 이상' },
                { label: 'ACoS',   value: acos,            color: 'var(--blue)',  note: '목표 25% 이하' },
                { label: '광고비',  value: fmt(adCost),     color: 'var(--text)',  note: '기간 집행' },
                { label: '광고매출', value: fmt(adRev),      color: 'var(--text)',  note: '기간 기여' },
              ].map(item => (
                <div key={item.label} style={{ background: 'var(--bg)', borderRadius: 'var(--r10)', padding: 11, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', marginTop: 3 }}>{item.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

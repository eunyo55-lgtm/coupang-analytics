'use client'

import { useState } from 'react'
import { useApp } from '@/lib/store'
import { useAnalytics } from '@/hooks/useAnalytics'

export default function InventoryPage() {
  const { state } = useApp()
  const { inventory } = useAnalytics()
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  const filtered = inventory.filter(item => {
    const matchName   = !search || (item.name + item.option).toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || item.status === statusFilter
    return matchName && matchStatus
  })

  const dangerCount = inventory.filter(i => i.status === 'danger').length
  const warnCount   = inventory.filter(i => i.status === 'warn').length
  const okCount     = inventory.filter(i => i.status === 'ok').length
  const totalSupply = inventory.reduce((s, i) => s + i.supplyQty, 0)

  return (
    <div>
      <div className="krow">
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">📦</div></div>
          <div className="kpi-lbl">총 SKU</div>
          <div className="kpi-val">{inventory.length}</div>
          <div className="kpi-foot">마스터 기준</div>
        </div>
        <div className="kpi kc-re">
          <div className="kpi-top"><div className="kpi-ico">🚨</div><div className="kpi-badge kb-dn">긴급</div></div>
          <div className="kpi-lbl">즉시 발주</div>
          <div className="kpi-val">{dangerCount}</div>
          <div className="kpi-foot">품목</div>
        </div>
        <div className="kpi kc-am">
          <div className="kpi-top"><div className="kpi-ico">⚠️</div></div>
          <div className="kpi-lbl">주의</div>
          <div className="kpi-val">{warnCount}</div>
          <div className="kpi-foot">안전재고 이하</div>
        </div>
        <div className="kpi kc-te">
          <div className="kpi-top"><div className="kpi-ico">🚚</div></div>
          <div className="kpi-lbl">공급 중</div>
          <div className="kpi-val">{fmt(totalSupply)}</div>
          <div className="kpi-foot">입고 대기</div>
        </div>
        <div className="kpi kc-gr">
          <div className="kpi-top"><div className="kpi-ico">✅</div></div>
          <div className="kpi-lbl">정상</div>
          <div className="kpi-val">{okCount}</div>
          <div className="kpi-foot">충족</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">⚙️</div><div className="ch-title">계산 기준</div></div>
        </div>
        <div className="cb">
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>
            일평균 판매량은 <strong style={{ color: 'var(--blue)' }}>{state.dateRange.label}</strong> 기간의 판매 데이터 기반으로 자동 계산됩니다.
            안전재고 14일 · 리드타임 7일 기준으로 권장 발주량을 산출합니다.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">📊</div><div><div className="ch-title">재고 현황</div><div className="ch-sub">{state.dateRange.label} 일평균 기준</div></div></div>
        </div>
        <div className="cb">
          <div className="frow">
            <input className="si" placeholder="🔍 상품명 검색..." value={search} onChange={e => setSearch(e.target.value)} />
            <select className="sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">전체</option>
              <option value="danger">🚨 긴급</option>
              <option value="warn">⚠️ 주의</option>
              <option value="ok">✅ 정상</option>
            </select>
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>상품명</th><th>옵션</th><th>현재고</th>
                  <th>공급중</th><th>일평균판매</th><th>소진예상</th>
                  <th>권장발주</th><th>상태</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length > 0 ? filtered.map((item, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 700, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
                    <td style={{ color: 'var(--t3)', fontSize: 11 }}>{item.option || '—'}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(item.stock)}</td>
                    <td style={{ fontWeight: 700, color: 'var(--purple)' }}>{fmt(item.supplyQty)}</td>
                    <td style={{ fontWeight: 700 }}>{item.dailySales.toFixed(1)}</td>
                    <td style={{ fontWeight: 800, color: item.status === 'danger' ? 'var(--red)' : item.status === 'warn' ? 'var(--amber)' : 'var(--green)' }}>
                      {item.daysLeft >= 999 ? '충분' : `${item.daysLeft}일`}
                    </td>
                    <td style={{ fontWeight: 800, color: 'var(--amber)' }}>{item.recommendOrder > 0 ? fmt(item.recommendOrder) : '—'}</td>
                    <td>
                      {item.status === 'danger' ? <span className="badge b-re">🚨 긴급</span>
                      : item.status === 'warn'  ? <span className="badge b-am">⚠️ 주의</span>
                      :                           <span className="badge b-gr">✅ 정상</span>}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={8}>
                    <div className="empty-st">
                      <div className="es-ico">📦</div>
                      <div className="es-t">{state.masterData.length ? '항목 없음' : '데이터를 업로드하면 자동 계산됩니다'}</div>
                      <div className="es-s">마스터 + 판매 + 공급 파일 필요</div>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

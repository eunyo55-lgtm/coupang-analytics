'use client'

import { useState } from 'react'
import { useApp } from '@/lib/store'
import { detectColumn, toNumber } from '@/lib/fileParser'

export default function SupplyPage() {
  const { state } = useApp()
  const [search, setSearch] = useState('')
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  // Parse supply data from uploaded file
  const supplyRows = state.supplyData.map(raw => {
    const r = raw as Record<string, unknown>
    const s0 = state.supplyData[0] as Record<string, unknown>
    const nameC = detectColumn(s0, ['상품명', 'item', 'productName'])
    const optC  = detectColumn(s0, ['옵션', 'option', '옵션명'])
    const qtyC  = detectColumn(s0, ['수량', 'qty', '공급수량', '입고수량'])
    const dateC = detectColumn(s0, ['날짜', 'date', '입고예정일', '예정일'])
    const statC = detectColumn(s0, ['상태', 'status'])
    return {
      name:         nameC ? String(r[nameC] || '') : '',
      option:       optC  ? String(r[optC]  || '') : '',
      qty:          toNumber(r[qtyC || '']),
      expectedDate: dateC ? String(r[dateC] || '') : '',
      status:       statC ? String(r[statC] || '') : '준비중',
    }
  }).filter(r => r.name)

  const filtered = supplyRows.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  )

  const totalQty = supplyRows.reduce((s, r) => s + r.qty, 0)

  return (
    <div>
      <div className="krow">
        <div className="kpi kc-te">
          <div className="kpi-top"><div className="kpi-ico">🚚</div></div>
          <div className="kpi-lbl">공급 중 품목</div>
          <div className="kpi-val">{supplyRows.length}</div>
          <div className="kpi-foot">SKU 수</div>
        </div>
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">📦</div></div>
          <div className="kpi-lbl">총 공급 수량</div>
          <div className="kpi-val">{fmt(totalQty)}</div>
          <div className="kpi-foot">입고 예정</div>
        </div>
        <div className="kpi kc-gr">
          <div className="kpi-top"><div className="kpi-ico">✅</div></div>
          <div className="kpi-lbl">입고 확정</div>
          <div className="kpi-val">{supplyRows.filter(r => r.status.includes('확정')).length}</div>
          <div className="kpi-foot">품목</div>
        </div>
        <div className="kpi kc-am">
          <div className="kpi-top"><div className="kpi-ico">⏳</div></div>
          <div className="kpi-lbl">준비 중</div>
          <div className="kpi-val">{supplyRows.filter(r => !r.status.includes('확정')).length}</div>
          <div className="kpi-foot">품목</div>
        </div>
      </div>

      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">🚚</div><div>
            <div className="ch-title">공급 현황</div>
            <div className="ch-sub">입고 대기 상품 목록</div>
          </div></div>
        </div>
        <div className="cb">
          <div className="frow">
            <input className="si" placeholder="🔍 상품명 검색..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="tw">
            <table>
              <thead><tr><th>상품명</th><th>옵션</th><th>공급 수량</th><th>입고 예정일</th><th>상태</th></tr></thead>
              <tbody>
                {filtered.length > 0 ? filtered.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 700, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                    <td style={{ color: 'var(--t3)', fontSize: 11 }}>{r.option || '—'}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(r.qty)}</td>
                    <td style={{ fontWeight: 600 }}>{r.expectedDate || '—'}</td>
                    <td>
                      {r.status.includes('확정') ? <span className="badge b-gr">✅ 입고확정</span>
                       : r.status.includes('운송') ? <span className="badge b-bl">🚢 운송중</span>
                       : <span className="badge b-am">⏳ 준비중</span>}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={5}>
                    <div className="empty-st">
                      <div className="es-ico">🚚</div>
                      <div className="es-t">{state.supplyData.length ? '검색 결과 없음' : '공급 중 수량 파일을 업로드해주세요'}</div>
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

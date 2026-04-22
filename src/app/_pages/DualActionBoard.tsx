'use client'

import { useMemo, useState } from 'react'

// ─── Types ───
export type ActionBoardRow = {
  name: string
  season: string
  hq_stock: number
  coupang_stock: number
  supply_qty: number
  daily_sales: number
  days_left: number | null
}

// ─── Helpers ───

// 오즈키즈 시즌 라벨 → 시즌 기준일 계산
// - 사계절: null (프로모션 제외)
// - 여름: 7/15
// - 봄/가을: 봄(4/15) 또는 가을(10/15) 중 '현재 시점에 의미있는' 쪽
// - 겨울: 12/15
// 기준일 계산 로직:
// - 오늘이 기준일 이전: 다가오는 가장 가까운 기준일
// - 오늘이 기준일 이후: 지난 기준일 (시즌오프 판단용)
function getSeasonDeadline(season: string, today: Date): Date | null {
  const y = today.getFullYear()
  const s = (season || '').trim()

  // 사계절은 시즌 개념 없음
  if (!s || s === '사계절' || s === '미지정') return null

  const makeDate = (month: number, day: number, year: number = y) =>
    new Date(year, month - 1, day)

  if (s === '여름') {
    const thisYear = makeDate(7, 15)
    // 올해 7/15가 지나지 않았으면 올해, 지났으면 내년? 아니다.
    // 시즌오프 판단이므로: 이미 지났으면 지난 기준일 유지
    return thisYear
  }
  if (s === '겨울') {
    const thisYear = makeDate(12, 15)
    return thisYear
  }
  if (s === '봄/가을' || s === '봄' || s === '가을') {
    const spring = makeDate(4, 15)
    const autumn = makeDate(10, 15)
    // 오늘과 가장 가까운 기준일 (과거/미래 불문)
    const diffSpring = Math.abs(today.getTime() - spring.getTime())
    const diffAutumn = Math.abs(today.getTime() - autumn.getTime())
    return diffSpring <= diffAutumn ? spring : autumn
  }
  // 그 외 알 수 없는 시즌
  return null
}

// 긴급 발주 수량 계산
function calcOrderQty(r: ActionBoardRow): number {
  const need = (r.daily_sales * 14) - (r.coupang_stock + r.supply_qty)
  const hqLimit = r.hq_stock * 0.5
  const firstQty = Math.min(need, hqLimit)
  if (firstQty <= 0) return 0
  return Math.ceil(firstQty / 10) * 10
}

// 두 날짜 사이 일수
function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

type Props = {
  rows: ActionBoardRow[]
  limit?: number
}

export default function DualActionBoard({ rows, limit = 10 }: Props) {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  // ── 긴급 발주 타겟 ──
  const urgentOrders = useMemo(() => {
    return rows
      .filter(r => r.daily_sales > 0 && r.days_left != null && r.days_left <= 14)
      .map(r => ({ ...r, suggest: calcOrderQty(r) }))
      .filter(r => r.suggest > 0)
      .sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99))  // 임박 순
      .slice(0, limit)
  }, [rows, limit])

  // ── 프로모션 타겟 ──
  const promoTargets = useMemo(() => {
    return rows
      .filter(r => r.coupang_stock > 0)
      .map(r => {
        const deadline = getSeasonDeadline(r.season, today)
        if (!deadline) return null
        const daysToDeadline = daysBetween(today, deadline)
        // 이미 시즌 지남: 악성 이월 재고
        const isPastSeason = daysToDeadline < 0
        // 시즌 내 소진 불가 예상
        const cantSellInSeason = !isPastSeason && r.days_left != null
          && r.days_left > daysToDeadline && daysToDeadline >= 0
        if (!isPastSeason && !cantSellInSeason) return null
        return {
          ...r,
          deadline,
          daysToDeadline,
          reason: isPastSeason ? '시즌 경과' : `시즌마감 ${daysToDeadline}일 前 소진불가`,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.coupang_stock - a.coupang_stock)  // 재고 많은 순
      .slice(0, limit)
  }, [rows, today, limit])

  // ── 복사 핸들러 ──
  const [copiedLeft, setCopiedLeft] = useState(false)
  const [copiedRight, setCopiedRight] = useState(false)

  const copyUrgent = async () => {
    const lines = ['[예외발주 요청건 - 2주 판매 확보용]']
    urgentOrders.forEach(r => lines.push(`${r.name} / ${r.suggest}개`))
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopiedLeft(true)
    setTimeout(() => setCopiedLeft(false), 2000)
  }

  const copyPromo = async () => {
    const lines = ['[시즌오프 대비 노출 지원 요청건]']
    promoTargets.forEach(r => {
      lines.push(`${r.name} / 현재 쿠팡재고: ${r.coupang_stock}개`)
    })
    lines.push('(시즌 마감 전 소진을 위해 기획전 노출 구좌 지원 부탁드립니다!)')
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopiedRight(true)
    setTimeout(() => setCopiedRight(false), 2000)
  }

  // ── 렌더 ──
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  return (
    <div className="g2" style={{ marginBottom: 12 }}>
      {/* 좌측: 긴급 발주 */}
      <div className="card" style={{ borderLeft: '4px solid #F04438' }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico" style={{ background: '#FEE4E2' }}>🚨</div>
            <div>
              <div className="ch-title" style={{ color: '#B42318' }}>긴급 예외발주 요망</div>
              <div className="ch-sub">소진예상 14일 이내 · 본사 가용한도 50% 기준</div>
            </div>
          </div>
          <button onClick={copyUrgent} disabled={urgentOrders.length === 0}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 700,
              border: '1px solid #F04438',
              borderRadius: 6,
              background: copiedLeft ? '#F04438' : '#fff',
              color: copiedLeft ? '#fff' : '#B42318',
              cursor: urgentOrders.length === 0 ? 'not-allowed' : 'pointer',
              opacity: urgentOrders.length === 0 ? 0.4 : 1,
            }}>
            {copiedLeft ? '✓ 복사됨' : '📝 텍스트 복사'}
          </button>
        </div>
        <div className="cb">
          {urgentOrders.length > 0 ? (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>상품명</th>
                    <th style={{ textAlign: 'right', width: 80 }}>쿠팡재고</th>
                    <th style={{ textAlign: 'right', width: 80 }}>소진예상</th>
                    <th style={{ textAlign: 'right', width: 90, background: '#FEF3F2' }}>💡제안수량</th>
                  </tr>
                </thead>
                <tbody>
                  {urgentOrders.map((r, i) => (
                    <tr key={i}>
                      <td style={{
                        fontWeight: 700,
                        maxWidth: 180,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }} title={r.name}>{r.name}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.coupang_stock)}</td>
                      <td style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color: (r.days_left ?? 99) < 7 ? '#B42318' : '#DC6803',
                      }}>{r.days_left}일</td>
                      <td style={{
                        textAlign: 'right',
                        fontWeight: 800,
                        color: '#B42318',
                        background: '#FEF3F2',
                      }}>{fmt(r.suggest)}개</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-st" style={{ padding: 20 }}>
              <div className="es-ico">✅</div>
              <div className="es-t">긴급 발주가 필요한 상품이 없어요</div>
            </div>
          )}
        </div>
      </div>

      {/* 우측: 프로모션 필요 */}
      <div className="card" style={{ borderLeft: '4px solid #F59E0B' }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico" style={{ background: '#FEF0C7' }}>💸</div>
            <div>
              <div className="ch-title" style={{ color: '#B54708' }}>즉시 프로모션 필요</div>
              <div className="ch-sub">시즌오프 경과 또는 시즌 내 소진 불가</div>
            </div>
          </div>
          <button onClick={copyPromo} disabled={promoTargets.length === 0}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 700,
              border: '1px solid #F59E0B',
              borderRadius: 6,
              background: copiedRight ? '#F59E0B' : '#fff',
              color: copiedRight ? '#fff' : '#B54708',
              cursor: promoTargets.length === 0 ? 'not-allowed' : 'pointer',
              opacity: promoTargets.length === 0 ? 0.4 : 1,
            }}>
            {copiedRight ? '✓ 복사됨' : '📝 텍스트 복사'}
          </button>
        </div>
        <div className="cb">
          {promoTargets.length > 0 ? (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>상품명</th>
                    <th style={{ width: 70 }}>시즌</th>
                    <th style={{ textAlign: 'right', width: 90, background: '#FFFAEB' }}>쿠팡재고</th>
                    <th style={{ fontSize: 10, width: 110 }}>사유</th>
                  </tr>
                </thead>
                <tbody>
                  {promoTargets.map((r, i) => (
                    <tr key={i}>
                      <td style={{
                        fontWeight: 700,
                        maxWidth: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }} title={r.name}>{r.name}</td>
                      <td style={{ fontSize: 11 }}>
                        <span className="badge b-bl">{r.season}</span>
                      </td>
                      <td style={{
                        textAlign: 'right',
                        fontWeight: 800,
                        color: '#B54708',
                        background: '#FFFAEB',
                      }}>{fmt(r.coupang_stock)}개</td>
                      <td style={{ fontSize: 10, color: 'var(--t3)' }}>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-st" style={{ padding: 20 }}>
              <div className="es-ico">✅</div>
              <div className="es-t">즉시 프로모션 대상이 없어요</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

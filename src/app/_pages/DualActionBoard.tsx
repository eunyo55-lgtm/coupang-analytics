'use client'

import { useMemo, useState, useEffect } from 'react'

// ─── Types ───
export type ActionBoardRow = {
  name: string
  season: string
  category: string
  image_url?: string
  hq_stock: number
  coupang_stock: number
  supply_qty: number
  daily_sales: number
  days_left: number | null
  option_count?: number
}

export type ActionBoardOption = {
  barcode: string
  option_value: string
  cost: number
  coupang_cost: number
  hq_stock: number
  coupang_stock: number
  supply_qty: number
  daily_sales: number
  days_left: number | null
}

// ─── Helpers ───

// 오즈키즈 시즌 라벨 → 시즌 기준일
// - 사계절: null (프로모션 제외)
// - 여름: 7/15
// - 봄/가을: 4/15 또는 10/15 중 오늘과 가까운 기준일
// - 겨울: 12/15
function getSeasonDeadline(season: string, today: Date): Date | null {
  const y = today.getFullYear()
  const s = (season || '').trim()
  if (!s || s === '사계절' || s === '미지정') return null
  const makeDate = (month: number, day: number, year: number = y) =>
    new Date(year, month - 1, day)

  if (s === '여름') return makeDate(7, 15)
  if (s === '겨울') return makeDate(12, 15)
  if (s === '봄/가을' || s === '봄' || s === '가을') {
    const spring = makeDate(4, 15)
    const autumn = makeDate(10, 15)
    const dSpring = Math.abs(today.getTime() - spring.getTime())
    const dAutumn = Math.abs(today.getTime() - autumn.getTime())
    return dSpring <= dAutumn ? spring : autumn
  }
  return null
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

// 상품 단위 제안 수량 (정수 올림, 10단위 올림 없음)
function calcOrderQtyProduct(r: ActionBoardRow): number {
  const need = (r.daily_sales * 14) - (r.coupang_stock + r.supply_qty)
  const hqLimit = r.hq_stock * 0.5
  const first = Math.min(need, hqLimit)
  if (first <= 0) return 0
  return Math.ceil(first)
}

// SKU 단위 제안 수량 (정수 올림, 10단위 올림 없음)
// 소진예상 14일 이하인 SKU만 제안 대상 (상품 단위 필터와 동일 기준)
function calcOrderQtyOption(o: ActionBoardOption): number {
  // 소진예상이 14일 초과거나 null(판매 없음)이면 제안 불필요
  if (o.days_left == null || o.days_left > 14) return 0
  const need = (o.daily_sales * 14) - (o.coupang_stock + o.supply_qty)
  const hqLimit = o.hq_stock * 0.5
  const first = Math.min(need, hqLimit)
  if (first <= 0) return 0
  return Math.ceil(first)
}

// ─── Props ───
type Props = {
  rows: ActionBoardRow[]
  from: string
  to: string
  optionsCache: Record<string, ActionBoardOption[]>
  onRequestOptions: (name: string) => void | Promise<void>
}

const INITIAL_VISIBLE = 10
const LOAD_MORE = 10

export default function DualActionBoard({ rows, from, to, optionsCache, onRequestOptions }: Props) {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  // ── 수동발주 검토 타겟 (상품 단위) ──
  // suggest는 상품 총합 기준 추정치. 옵션이 로드되면 SKU 합계로 재계산되어 화면/복사에 반영됨.
  const urgentAll = useMemo(() => {
    return rows
      .filter(r => r.daily_sales > 0 && r.days_left != null && r.days_left <= 14)
      .map(r => ({ ...r, suggest: calcOrderQtyProduct(r) }))
      .filter(r => r.suggest > 0)
      .sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99))
  }, [rows])

  // 옵션이 로드된 상품의 "실효 제안수량" = SKU별 제안수량의 합
  // 로드 안 된 상품은 null 반환 → 호출자가 fallback 처리
  const effectiveSuggest = (name: string): number | null => {
    const cacheKey = `${name}||${from}||${to}`
    const opts = optionsCache[cacheKey]
    if (!opts) return null
    return opts.reduce((s, o) => s + calcOrderQtyOption(o), 0)
  }

  // ── 재고 소진 필요 타겟 ──
  const promoAll = useMemo(() => {
    return rows
      .filter(r => r.coupang_stock > 0)
      .map(r => {
        const deadline = getSeasonDeadline(r.season, today)
        if (!deadline) return null
        const daysToDeadline = daysBetween(today, deadline)
        const isPast = daysToDeadline < 0
        const cantSell = !isPast && r.days_left != null
          && r.days_left > daysToDeadline && daysToDeadline >= 0
        if (!isPast && !cantSell) return null
        return {
          ...r,
          deadline,
          daysToDeadline,
          reason: isPast ? '시즌 경과' : `마감 ${daysToDeadline}일 전 소진불가`,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.coupang_stock - a.coupang_stock)
  }, [rows, today])

  // ── 더보기 상태 ──
  const [urgentVisible, setUrgentVisible] = useState(INITIAL_VISIBLE)
  const [promoVisible, setPromoVisible] = useState(INITIAL_VISIBLE)
  useEffect(() => { setUrgentVisible(INITIAL_VISIBLE); setPromoVisible(INITIAL_VISIBLE) }, [rows])

  const urgentList = urgentAll.slice(0, urgentVisible)
  const promoList  = promoAll.slice(0, promoVisible)

  // ── 토글 state ──
  const [expandedUrgent, setExpandedUrgent] = useState<Set<string>>(new Set())

  const toggleUrgent = (name: string) => {
    const s = new Set(expandedUrgent)
    if (s.has(name)) { s.delete(name); setExpandedUrgent(s); return }
    s.add(name); setExpandedUrgent(s)
    const cacheKey = `${name}||${from}||${to}`
    if (!optionsCache[cacheKey]) onRequestOptions(name)
  }

  // ── 복사 ──
  const [copiedLeft, setCopiedLeft] = useState(false)
  const [copiedRight, setCopiedRight] = useState(false)

  // 발주 복사: SKU가 로드된 상품은 SKU별로, 아니면 상품 총합.
  // SKU 합이 0이면 해당 상품은 skip (실제 보낼 수량 없음)
  const copyUrgent = async () => {
    const lines = ['[예외발주 요청건 - 2주 판매 확보용]']
    for (const r of urgentList) {
      const cacheKey = `${r.name}||${from}||${to}`
      const opts = optionsCache[cacheKey]
      if (opts && opts.length > 0) {
        // SKU 단위 상세 라인
        const skuLines: string[] = []
        let sumQty = 0
        for (const o of opts) {
          const q = calcOrderQtyOption(o)
          if (q > 0) {
            const optLabel = o.option_value || '기본'
            skuLines.push(`  └ ${optLabel} (${o.barcode}) / ${q}개`)
            sumQty += q
          }
        }
        // SKU 합이 0이면 실제로 발주할 SKU가 없음 → skip
        if (sumQty === 0) continue
        lines.push(`${r.name} (합계 ${sumQty}개)`)
        lines.push(...skuLines)
      } else {
        // 옵션 미로드: 상품 총합 기준 추정치
        lines.push(`${r.name} / ${r.suggest}개 (SKU 확인 전 추정)`)
      }
    }
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopiedLeft(true)
    setTimeout(() => setCopiedLeft(false), 2000)
  }

  const copyPromo = async () => {
    const lines = ['[시즌오프 대비 노출 지원 요청건]']
    promoList.forEach(r => {
      lines.push(`${r.name} / 현재 쿠팡재고: ${r.coupang_stock}개`)
    })
    lines.push('(시즌 마감 전 소진을 위해 기획전 노출 구좌 지원 부탁드립니다!)')
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopiedRight(true)
    setTimeout(() => setCopiedRight(false), 2000)
  }

  return (
    <>
      {/* ── 수동발주 검토 ── */}
      <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid #F04438' }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico" style={{ background: '#FEE4E2' }}>🚨</div>
            <div>
              <div className="ch-title" style={{ color: '#B42318' }}>수동 발주 검토</div>
              <div className="ch-sub">
                소진예상 14일 이내 · 본사 가용한도 50% 기준 · 상품명 클릭 시 SKU 합계로 정확히 재계산
                {` · 총 ${urgentAll.length}개 상품`}
                <span style={{ fontSize: 10, color: '#B54708', marginLeft: 6, fontWeight: 600 }}>
                  ※ ≈는 상품 집계 추정치, 실제 SKU 합계와 차이날 수 있음
                </span>
              </div>
            </div>
          </div>
          <button onClick={copyUrgent} disabled={urgentList.length === 0}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px', fontSize: 11, fontWeight: 700,
              border: '1px solid #F04438', borderRadius: 6,
              background: copiedLeft ? '#F04438' : '#fff',
              color: copiedLeft ? '#fff' : '#B42318',
              cursor: urgentList.length === 0 ? 'not-allowed' : 'pointer',
              opacity: urgentList.length === 0 ? 0.4 : 1,
            }}>
            {copiedLeft ? '✓ 복사됨' : '📝 텍스트 복사'}
          </button>
        </div>
        <div className="cb">
          {urgentList.length > 0 ? (
            <>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>이미지</th>
                      <th style={{ width: 180 }}>상품명</th>
                      <th style={{ textAlign: 'right', width: 80 }}>본사재고</th>
                      <th style={{ textAlign: 'right', width: 80 }}>쿠팡재고</th>
                      <th style={{ textAlign: 'right', width: 80 }}>공급중</th>
                      <th style={{ textAlign: 'right', width: 90 }}>일평균</th>
                      <th style={{ textAlign: 'right', width: 80 }}>소진예상</th>
                      <th style={{ textAlign: 'right', width: 100, background: '#FEF3F2' }}>💡제안수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {urgentList.flatMap(r => {
                      const isOpen = expandedUrgent.has(r.name)
                      const cacheKey = `${r.name}||${from}||${to}`
                      const opts = optionsCache[cacheKey]
                      // 옵션 로드됐으면 SKU 합계로 재계산 (정확한 값)
                      // 안 됐으면 상품 총합 추정치(r.suggest) 사용
                      const skuSum = effectiveSuggest(r.name)
                      const displayQty = skuSum != null ? skuSum : r.suggest
                      const isEstimate = skuSum == null
                      const mainRow = (
                        <tr key={r.name} style={{ cursor: 'pointer' }} onClick={() => toggleUrgent(r.name)}>
                          <td>{r.image_url
                            ? <img src={r.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            : <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>-</div>}
                          </td>
                          <td style={{ fontWeight: 700 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ color: 'var(--t3)', fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>
                              <div style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                              {r.category && <span className="badge b-gr" style={{ fontSize: 10 }}>{r.category}</span>}
                              {r.season   && <span className="badge b-bl" style={{ fontSize: 10 }}>{r.season}</span>}
                              {r.option_count ? <span style={{ fontSize: 10, color: 'var(--t3)' }}>옵션 {r.option_count}개</span> : null}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>{fmt(r.hq_stock)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(r.coupang_stock)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--purple)' }}>{fmt(r.supply_qty)}</td>
                          <td style={{ textAlign: 'right' }}>{r.daily_sales.toFixed(1)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700,
                            color: (r.days_left ?? 99) < 7 ? '#B42318' : '#DC6803' }}>
                            {r.days_left}일
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 800,
                            color: displayQty > 0 ? '#B42318' : 'var(--t3)',
                            background: displayQty > 0 ? '#FEF3F2' : 'transparent' }}
                            title={isEstimate
                              ? '상품 집계 기준 추정치 · 실제는 SKU별로 차이날 수 있음. 클릭하여 정확한 합계 확인'
                              : 'SKU 합계 (정확한 값)'}>
                            {displayQty > 0 ? (
                              <>
                                {isEstimate && (
                                  <span style={{ fontSize: 9, fontWeight: 700, color: '#B54708',
                                    background: '#FFFAEB', padding: '1px 5px', borderRadius: 4,
                                    marginRight: 4, verticalAlign: 'middle' }}>
                                    추정
                                  </span>
                                )}
                                <span>
                                  {isEstimate ? '≈' : ''}{fmt(displayQty)}개
                                </span>
                              </>
                            ) : '—'}
                          </td>
                        </tr>
                      )
                      if (!isOpen) return [mainRow]
                      if (!opts) {
                        return [mainRow, (
                          <tr key={r.name + '__loading'} style={{ background: '#FFFBFA' }}>
                            <td colSpan={8} style={{ textAlign: 'center', fontSize: 11, color: 'var(--t3)', padding: 8 }}>
                              ⏳ SKU 옵션 불러오는 중...
                            </td>
                          </tr>
                        )]
                      }
                      const optRows = opts.map(o => {
                        const q = calcOrderQtyOption(o)
                        return (
                          <tr key={r.name + '_' + o.barcode} style={{ background: '#FFFBFA' }}>
                            <td></td>
                            <td style={{ paddingLeft: 28, fontSize: 11, color: 'var(--t2)' }}>
                              └ {o.option_value || '기본'} <span style={{ color: 'var(--t3)', fontSize: 10 }}>· {o.barcode}</span>
                            </td>
                            <td style={{ textAlign: 'right', fontSize: 11 }}>{fmt(o.hq_stock)}</td>
                            <td style={{ textAlign: 'right', fontSize: 11 }}>{fmt(o.coupang_stock)}</td>
                            <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--purple)' }}>{fmt(o.supply_qty)}</td>
                            <td style={{ textAlign: 'right', fontSize: 11 }}>{o.daily_sales.toFixed(1)}</td>
                            <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 700,
                              color: o.days_left == null ? 'var(--t3)'
                                   : o.days_left < 7 ? '#B42318'
                                   : o.days_left < 14 ? '#DC6803' : 'var(--green)' }}>
                              {o.days_left == null ? '—' : `${o.days_left}일`}
                            </td>
                            <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 800,
                              color: q > 0 ? '#B42318' : 'var(--t3)', background: q > 0 ? '#FEF3F2' : 'transparent' }}>
                              {q > 0 ? `${fmt(q)}개` : '—'}
                            </td>
                          </tr>
                        )
                      })
                      return [mainRow, ...optRows]
                    })}
                  </tbody>
                </table>
              </div>
              {urgentVisible < urgentAll.length && (
                <div style={{ textAlign: 'center', marginTop: 10 }}>
                  <button onClick={() => setUrgentVisible(v => v + LOAD_MORE)}
                    style={{
                      fontSize: 11, padding: '6px 14px', borderRadius: 6,
                      border: '1px solid #F04438', background: '#FFFBFA', color: '#B42318',
                      cursor: 'pointer', fontWeight: 700,
                    }}>
                    더 보기 ({urgentVisible} / {urgentAll.length})
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-st" style={{ padding: 20 }}>
              <div className="es-ico">✅</div>
              <div className="es-t">수동 발주가 필요한 상품이 없어요</div>
            </div>
          )}
        </div>
      </div>

      {/* ── 재고 소진 필요 ── */}
      <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid #F59E0B' }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico" style={{ background: '#FEF0C7' }}>💸</div>
            <div>
              <div className="ch-title" style={{ color: '#B54708' }}>재고 소진 필요</div>
              <div className="ch-sub">
                시즌오프 경과 또는 시즌 내 소진 불가 · 총 {promoAll.length}개 상품
              </div>
            </div>
          </div>
          <button onClick={copyPromo} disabled={promoList.length === 0}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px', fontSize: 11, fontWeight: 700,
              border: '1px solid #F59E0B', borderRadius: 6,
              background: copiedRight ? '#F59E0B' : '#fff',
              color: copiedRight ? '#fff' : '#B54708',
              cursor: promoList.length === 0 ? 'not-allowed' : 'pointer',
              opacity: promoList.length === 0 ? 0.4 : 1,
            }}>
            {copiedRight ? '✓ 복사됨' : '📝 텍스트 복사'}
          </button>
        </div>
        <div className="cb">
          {promoList.length > 0 ? (
            <>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>이미지</th>
                      <th style={{ width: 180 }}>상품명</th>
                      <th style={{ width: 80 }}>시즌</th>
                      <th>카테고리</th>
                      <th style={{ textAlign: 'right', width: 100, background: '#FFFAEB' }}>쿠팡재고</th>
                      <th style={{ width: 150 }}>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promoList.map((r, i) => (
                      <tr key={i}>
                        <td>{r.image_url
                          ? <img src={r.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>-</div>}
                        </td>
                        <td style={{ fontWeight: 700, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
                          {r.name}
                        </td>
                        <td><span className="badge b-bl" style={{ fontSize: 10 }}>{r.season}</span></td>
                        <td style={{ fontSize: 11 }}>{r.category}</td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: '#B54708', background: '#FFFAEB' }}>
                          {fmt(r.coupang_stock)}개
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--t3)' }}>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {promoVisible < promoAll.length && (
                <div style={{ textAlign: 'center', marginTop: 10 }}>
                  <button onClick={() => setPromoVisible(v => v + LOAD_MORE)}
                    style={{
                      fontSize: 11, padding: '6px 14px', borderRadius: 6,
                      border: '1px solid #F59E0B', background: '#FFFBEB', color: '#B54708',
                      cursor: 'pointer', fontWeight: 700,
                    }}>
                    더 보기 ({promoVisible} / {promoAll.length})
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-st" style={{ padding: 20 }}>
              <div className="es-ico">✅</div>
              <div className="es-t">즉시 소진 대상이 없어요</div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

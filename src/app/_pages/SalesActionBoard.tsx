'use client'

import { useMemo } from 'react'
import type { RankingEntry } from '@/types'

// ─── Types ───
export type SalesActionProduct = {
  productName: string
  imageUrl: string
  category: string
  season: string
  ytdQty: number
  chartDaily: { date: string; qty: number; rev: number }[]  // 차트용 일자별 (최소 14일 필요)
}

type Props = {
  products: SalesActionProduct[]
  rankings: RankingEntry[]
  /** chartFrom~chartTo 기간 내 최신 날짜 (from 없으면 오늘). 최근 7일 vs 이전 7일 기준점 */
  anchorDate: string
}

// ─── Helpers ───
const MAX_ITEMS = 5

function avgOverDays(daily: { date: string; qty: number }[], dates: string[]): number {
  const map = new Map(daily.map(d => [d.date, d.qty]))
  const sum = dates.reduce((s, d) => s + (map.get(d) || 0), 0)
  return dates.length > 0 ? sum / dates.length : 0
}

function subtractDays(ymd: string, n: number): string {
  const d = new Date(ymd); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function buildDateRange(endYmd: string, days: number): string[] {
  // endYmd 포함 최근 days일
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(subtractDays(endYmd, i))
  return out
}

function coupangSearchUrl(name: string): string {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(name)}`
}

export default function SalesActionBoard({ products, rankings, anchorDate }: Props) {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  // ── 기간 계산: 최근 7일 vs 이전 7일 ──
  const { recent7, prev7 } = useMemo(() => {
    const anchor = anchorDate || new Date().toISOString().slice(0, 10)
    return {
      recent7: buildDateRange(anchor, 7),                    // 최근 7일 (오늘~6일전)
      prev7: buildDateRange(subtractDays(anchor, 7), 7),     // 그 전 7일 (7~13일전)
    }
  }, [anchorDate])

  // ── 매출 성과 변동 타겟 ──
  type VelocityRow = SalesActionProduct & {
    avgRecent: number
    avgPrev: number
    changeRatio: number  // recent/prev
    changePct: number    // ((recent-prev)/prev)*100
    signal: 'surge' | 'drop'
  }

  const velocityTargets = useMemo(() => {
    const rows: VelocityRow[] = []
    for (const p of products) {
      const avgRecent = avgOverDays(p.chartDaily, recent7)
      const avgPrev = avgOverDays(p.chartDaily, prev7)
      // 양쪽 다 0이면 skip (판매 없던 상품)
      if (avgRecent === 0 && avgPrev === 0) continue

      let signal: 'surge' | 'drop' | null = null
      let changeRatio: number
      if (avgPrev === 0) {
        // 이전 0 → 최근 판매 시작 = 급증
        if (avgRecent > 0) { signal = 'surge'; changeRatio = Infinity }
        else continue
      } else {
        changeRatio = avgRecent / avgPrev
        if (changeRatio <= 0.5) signal = 'drop'
        else if (changeRatio >= 1.5) signal = 'surge'
      }

      if (!signal) continue

      const changePct = avgPrev === 0 ? 100 : ((avgRecent - avgPrev) / avgPrev) * 100
      rows.push({ ...p, avgRecent, avgPrev, changeRatio, changePct, signal })
    }
    // 누적 판매량 높은 순
    rows.sort((a, b) => b.ytdQty - a.ytdQty)
    return rows.slice(0, MAX_ITEMS)
  }, [products, recent7, prev7])

  // ── 검색 랭킹 레이더 타겟 ──
  type RankingRow = {
    productName: string
    keyword: string
    rankToday: number
    rankYesterday: number
    delta: number  // 양수 = 하락 (순위 숫자가 커짐)
    signal: 'drop' | 'page1-reach'
    ytdQty?: number
    imageUrl?: string
    category?: string
    season?: string
  }

  const rankingTargets = useMemo(() => {
    if (!rankings || rankings.length === 0) return []

    // 상품명별 최신 1건만 사용 (여러 키워드면 오늘 랭킹이 가장 좋은 것 하나 선택)
    const byName = new Map<string, RankingEntry>()
    for (const r of rankings) {
      const existing = byName.get(r.productName)
      if (!existing || (r.rankToday > 0 && r.rankToday < existing.rankToday)) {
        byName.set(r.productName, r)
      }
    }

    // 상품명 → YTD 판매 매핑
    const prodMap = new Map(products.map(p => [p.productName, p]))

    const dropRows: RankingRow[] = []
    const reachRows: RankingRow[] = []
    for (const r of byName.values()) {
      const delta = r.rankToday - r.rankYesterday
      const prod = prodMap.get(r.productName)
      // 경고: 10계단 이상 하락 (숫자 커짐)
      if (r.rankYesterday > 0 && delta >= 10) {
        dropRows.push({
          productName: r.productName, keyword: r.keyword,
          rankToday: r.rankToday, rankYesterday: r.rankYesterday,
          delta, signal: 'drop',
          ytdQty: prod?.ytdQty, imageUrl: prod?.imageUrl,
          category: prod?.category, season: prod?.season,
        })
      }
      // 1페이지 도약: 40~80위 + 일평균 판매 > 0
      else if (r.rankToday >= 40 && r.rankToday <= 80) {
        const avg14 = prod ? avgOverDays(
          prod.chartDaily, buildDateRange(anchorDate || new Date().toISOString().slice(0, 10), 14)
        ) : 0
        if (avg14 > 0) {
          reachRows.push({
            productName: r.productName, keyword: r.keyword,
            rankToday: r.rankToday, rankYesterday: r.rankYesterday,
            delta, signal: 'page1-reach',
            ytdQty: prod?.ytdQty, imageUrl: prod?.imageUrl,
            category: prod?.category, season: prod?.season,
          })
        }
      }
    }

    // 하락폭 큰 순 → 현재 랭킹 좋은 순 (숫자 낮은 순)
    dropRows.sort((a, b) => b.delta - a.delta || a.rankToday - b.rankToday)
    reachRows.sort((a, b) => a.rankToday - b.rankToday)
    return [...dropRows, ...reachRows].slice(0, MAX_ITEMS)
  }, [rankings, products, anchorDate])

  return (
    <div className="g2" style={{ marginBottom: 12 }}>
      {/* ─── 매출 성과 변동 ─── */}
      <div className="card" style={{ borderLeft: '4px solid #1570EF' }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico" style={{ background: '#D1E9FF' }}>📈</div>
            <div>
              <div className="ch-title" style={{ color: '#175CD3' }}>매출 성과 변동</div>
              <div className="ch-sub">
                최근 7일 vs 이전 7일 · 급감 ≤50% / 급증 ≥150%
                <span style={{ marginLeft: 6, fontSize: 10 }}>· 총 {velocityTargets.length}개 표시</span>
              </div>
            </div>
          </div>
        </div>
        <div className="cb">
          {velocityTargets.length > 0 ? (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>이미지</th>
                    <th style={{ width: 180 }}>상품명</th>
                    <th style={{ textAlign: 'right', width: 70 }}>이전 7일</th>
                    <th style={{ textAlign: 'right', width: 70 }}>최근 7일</th>
                    <th style={{ textAlign: 'right', width: 80 }}>증감률</th>
                    <th>시그널</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {velocityTargets.map(r => {
                    const isDrop = r.signal === 'drop'
                    return (
                      <tr key={r.productName}>
                        <td>{r.imageUrl
                          ? <img src={r.imageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>-</div>}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          <div style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={r.productName}>
                            {r.productName}
                          </div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                            {r.category && <span className="badge b-gr" style={{ fontSize: 10 }}>{r.category}</span>}
                            {r.season && <span className="badge b-bl" style={{ fontSize: 10 }}>{r.season}</span>}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--t3)' }}>{r.avgPrev.toFixed(1)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700,
                          color: isDrop ? '#B42318' : '#027A48' }}>
                          {r.avgRecent.toFixed(1)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800,
                          color: isDrop ? '#B42318' : '#027A48' }}>
                          {r.changePct === Infinity ? '신규' : `${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(0)}%`}
                        </td>
                        <td>
                          {isDrop ? (
                            <span style={{ fontSize: 10, color: '#B42318', fontWeight: 700,
                              background: '#FEF3F2', padding: '3px 8px', borderRadius: 10 }}>
                              🚨 판매 급감
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: '#027A48', fontWeight: 700,
                              background: '#ECFDF3', padding: '3px 8px', borderRadius: 10 }}>
                              🔥 판매 급증
                            </span>
                          )}
                        </td>
                        <td>
                          <a href={coupangSearchUrl(r.productName)} target="_blank" rel="noopener noreferrer"
                            title="쿠팡에서 검색"
                            style={{ fontSize: 14, textDecoration: 'none' }}>
                            🔗
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-st" style={{ padding: 20 }}>
              <div className="es-ico">✅</div>
              <div className="es-t">성과 변동이 뚜렷한 상품이 없어요</div>
            </div>
          )}
        </div>
      </div>

      {/* ─── 검색 랭킹 레이더 ─── */}
      <div className="card" style={{ borderLeft: '4px solid #7F56D9' }}>
        <div className="ch">
          <div className="ch-l"><div className="ch-ico" style={{ background: '#F4EBFF' }}>🏆</div>
            <div>
              <div className="ch-title" style={{ color: '#6941C6' }}>검색 랭킹 레이더</div>
              <div className="ch-sub">
                10계단+ 하락 경고 / 40~80위 1페이지 도약 타겟
                <span style={{ marginLeft: 6, fontSize: 10 }}>· 총 {rankingTargets.length}개 표시</span>
              </div>
            </div>
          </div>
        </div>
        <div className="cb">
          {rankingTargets.length > 0 ? (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>이미지</th>
                    <th style={{ width: 170 }}>상품명 · 키워드</th>
                    <th style={{ textAlign: 'right', width: 60 }}>어제</th>
                    <th style={{ textAlign: 'right', width: 60 }}>오늘</th>
                    <th style={{ textAlign: 'right', width: 70 }}>변동</th>
                    <th>시그널</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rankingTargets.map((r, i) => {
                    const isDrop = r.signal === 'drop'
                    return (
                      <tr key={i}>
                        <td>{r.imageUrl
                          ? <img src={r.imageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>-</div>}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          <div style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={r.productName}>
                            {r.productName}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
                            🔍 {r.keyword}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--t3)' }}>
                          {r.rankYesterday > 0 ? `${r.rankYesterday}위` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {r.rankToday > 0 ? `${r.rankToday}위` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800,
                          color: isDrop ? '#B42318' : '#6941C6' }}>
                          {isDrop ? `▼${r.delta}` : `${r.rankToday}위`}
                        </td>
                        <td>
                          {isDrop ? (
                            <span style={{ fontSize: 10, color: '#B42318', fontWeight: 700,
                              background: '#FEF3F2', padding: '3px 8px', borderRadius: 10 }}>
                              📉 {r.delta}계단 하락
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: '#6941C6', fontWeight: 700,
                              background: '#F4EBFF', padding: '3px 8px', borderRadius: 10 }}>
                              🎯 1페이지 도약 가시권
                            </span>
                          )}
                        </td>
                        <td>
                          <a href={coupangSearchUrl(r.keyword)} target="_blank" rel="noopener noreferrer"
                            title={`"${r.keyword}" 쿠팡 검색`}
                            style={{ fontSize: 14, textDecoration: 'none' }}>
                            🔗
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-st" style={{ padding: 20 }}>
              <div className="es-ico">{rankings.length === 0 ? '📡' : '✅'}</div>
              <div className="es-t">
                {rankings.length === 0 ? '랭킹 데이터가 아직 수집되지 않았어요' : '주목할 랭킹 변동이 없어요'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

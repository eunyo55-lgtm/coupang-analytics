'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import { toYMD } from '@/lib/dateUtils'
import type { NaverKeywordResult, RankingEntry } from '@/types'

const today = new Date()
today.setHours(0, 0, 0, 0)

export default function RankingPage() {
  const { state, dispatch } = useApp()
  const { dateRange } = state

  const [pname,  setPname]  = useState('')
  const [kw,     setKw]     = useState('')
  const [today_, setToday_] = useState('')
  const [yest,   setYest]   = useState('')
  const [saving, setSaving] = useState(false)

  const [naverKw,      setNaverKw]      = useState('')
  const [naverLoading, setNaverLoading] = useState(false)
  const [naverResults, setNaverResults] = useState<NaverKeywordResult[]>([])

  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

  // Load rankings from Supabase on mount
  useEffect(() => {
    loadRankings()
  }, [dateRange]) // eslint-disable-line

  async function loadRankings() {
    try {
      const { data, error } = await supabase
        .from('rankings')
        .select('*')
        .gte('date', toYMD(dateRange.from))
        .lte('date', toYMD(dateRange.to))
        .order('date', { ascending: false })
      if (error) throw error
      if (data) {
        dispatch({
          type: 'SET_RANKINGS',
          payload: (data as any[]).map((r: any) => ({
            id: r.id,
            productName: r.product_name,
            keyword: r.keyword,
            rankToday: r.rank_today,
            rankYesterday: r.rank_yesterday ?? 0,
            date: r.date,
          })),
        })
      }
    } catch {
      // Supabase not configured — use local state only
    }
  }

  async function addRanking() {
    if (!pname || !kw) return
    const entry: RankingEntry = {
      productName: pname,
      keyword: kw,
      rankToday:     parseInt(today_) || 0,
      rankYesterday: parseInt(yest)   || 0,
      date: toYMD(today),
    }

    // Save to Supabase
    setSaving(true)
    try {
      const { data } = await supabase.from('rankings').insert({
        product_name:    entry.productName,
        keyword:         entry.keyword,
        rank_today:      entry.rankToday,
        rank_yesterday:  entry.rankYesterday,
        date:            entry.date,
      }).select().single()
      if (data) entry.id = data.id
    } catch { /* offline fallback */ }
    setSaving(false)

    dispatch({ type: 'ADD_RANKING', payload: entry })
    setPname(''); setKw(''); setToday_(''); setYest('')
  }

  async function naverLookup() {
    const keywords = naverKw.split(/[,\s]+/).filter(Boolean)
    if (!keywords.length) return
    setNaverLoading(true)
    try {
      const res  = await fetch('/api/naver-keywords', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ keywords }),
      })
      const json = await res.json()
      setNaverResults(json.results || [])
    } catch {
      setNaverResults([])
    }
    setNaverLoading(false)
  }

  const withRank = state.rankings.filter(r => r.rankToday > 0)
  const avgRank  = withRank.length
    ? Math.round(withRank.reduce((s, r) => s + r.rankToday, 0) / withRank.length)
    : 0
  const top10    = state.rankings.filter(r => r.rankToday > 0 && r.rankToday <= 10).length
  const totalNaverSearch = naverResults.reduce((s, r) => s + r.total, 0)

  return (
    <div>
      <div className="krow">
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">🔑</div></div>
          <div className="kpi-lbl">등록 키워드</div>
          <div className="kpi-val">{state.rankings.length}</div>
          <div className="kpi-foot">추적 중</div>
        </div>
        <div className="kpi kc-am">
          <div className="kpi-top"><div className="kpi-ico">🥇</div></div>
          <div className="kpi-lbl">Top 10</div>
          <div className="kpi-val">{top10}</div>
          <div className="kpi-foot">키워드 수</div>
        </div>
        <div className="kpi kc-gr">
          <div className="kpi-top"><div className="kpi-ico">📍</div></div>
          <div className="kpi-lbl">평균 순위</div>
          <div className="kpi-val">{avgRank || '—'}</div>
          <div className="kpi-foot">위</div>
        </div>
        <div className="kpi kc-pu">
          <div className="kpi-top"><div className="kpi-ico">🔎</div></div>
          <div className="kpi-lbl">네이버 검색량</div>
          <div className="kpi-val">{totalNaverSearch ? fmt(totalNaverSearch) : '—'}</div>
          <div className="kpi-foot">월간 합계</div>
        </div>
      </div>

      <div className="g2">
        {/* 쿠팡 랭킹 입력 */}
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🏆</div><div>
              <div className="ch-title">쿠팡 랭킹 입력</div>
              <div className="ch-sub">로컬봇 데이터 수동 등록</div>
            </div></div>
          </div>
          <div className="cb">
            <div className="fgrid" style={{ marginBottom: 12 }}>
              <div className="fcol" style={{ gridColumn: '1 / -1' }}>
                <label className="fl">📦 상품명</label>
                <input className="fi" value={pname} onChange={e => setPname(e.target.value)} placeholder="상품명 입력" />
              </div>
              <div className="fcol">
                <label className="fl">🔑 키워드</label>
                <input className="fi" value={kw} onChange={e => setKw(e.target.value)} placeholder="키워드" />
              </div>
              <div className="fcol">
                <label className="fl">오늘 순위</label>
                <input className="fi" type="number" value={today_} onChange={e => setToday_(e.target.value)} placeholder="순위" />
              </div>
              <div className="fcol">
                <label className="fl">어제 순위</label>
                <input className="fi" type="number" value={yest} onChange={e => setYest(e.target.value)} placeholder="순위" />
              </div>
              <div className="fcol" style={{ justifyContent: 'flex-end' }}>
                <button className="btn-p" onClick={addRanking} disabled={saving} style={{ marginTop: 18, width: '100%' }}>
                  {saving ? '저장 중...' : '➕ 추가'}
                </button>
              </div>
            </div>

            <div className="tw">
              <table>
                <thead><tr><th>상품</th><th>키워드</th><th>어제</th><th>오늘</th><th>변동</th></tr></thead>
                <tbody>
                  {state.rankings.length > 0 ? state.rankings.slice(0, 20).map((r, i) => {
                    const diff = r.rankYesterday && r.rankToday ? r.rankYesterday - r.rankToday : 0
                    const rc   = r.rankToday === 1 ? 'rm1' : r.rankToday <= 3 ? 'rm2' : r.rankToday <= 10 ? 'rm3' : 'rmn'
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 700, fontSize: 12, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.productName}</td>
                        <td><span className="kw-tag">{r.keyword}</span></td>
                        <td style={{ color: 'var(--t3)', fontWeight: 600 }}>{r.rankYesterday || '—'}</td>
                        <td><span className={`rank-medal ${rc}`}>{r.rankToday || '—'}</span></td>
                        <td>
                          {diff > 0 ? <span style={{ color: 'var(--green)', fontWeight: 800, fontSize: 11 }}>▲{diff}</span>
                          : diff < 0 ? <span style={{ color: 'var(--red)',   fontWeight: 800, fontSize: 11 }}>▼{Math.abs(diff)}</span>
                          : <span style={{ color: 'var(--t3)', fontSize: 11 }}>—</span>}
                        </td>
                      </tr>
                    )
                  }) : (
                    <tr><td colSpan={5}><div className="empty-st" style={{ padding: 20 }}><div className="es-ico">🏆</div><div className="es-t">랭킹을 입력하세요</div></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 네이버 키워드 검색량 */}
        <div className="card">
          <div className="ch">
            <div className="ch-l"><div className="ch-ico">🔎</div><div>
              <div className="ch-title">네이버 키워드 검색량</div>
              <div className="ch-sub">네이버 검색 API 조회</div>
            </div></div>
          </div>
          <div className="cb">
            <div className="frow">
              <input className="si" value={naverKw} onChange={e => setNaverKw(e.target.value)} placeholder="키워드 쉼표로 구분 입력..."
                onKeyDown={e => e.key === 'Enter' && naverLookup()} />
              <button className="btn-p" onClick={naverLookup} disabled={naverLoading}>
                {naverLoading ? <><span className="spinner" /> 조회중</> : '🔍 조회'}
              </button>
            </div>
            <div className="tw">
              <table>
                <thead><tr><th>키워드</th><th>PC</th><th>모바일</th><th>합계</th><th>경쟁도</th></tr></thead>
                <tbody>
                  {naverResults.length > 0 ? naverResults.map((r, i) => (
                    <tr key={i}>
                      <td><span className="kw-tag">{r.keyword}</span></td>
                      <td style={{ fontWeight: 700 }}>{fmt(r.pc)}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(r.mobile)}</td>
                      <td style={{ fontWeight: 800 }}>{fmt(r.total)}</td>
                      <td>
                        <span className={`badge ${r.competition === 'high' ? 'b-re' : r.competition === 'mid' ? 'b-am' : 'b-gr'}`}>
                          {r.competition === 'high' ? '높음' : r.competition === 'mid' ? '중간' : '낮음'}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5}><div className="empty-st" style={{ padding: 20 }}>
                      <div className="es-ico">🔎</div><div className="es-t">키워드를 입력하고 조회하세요</div>
                    </div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const SUPA_URL = 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eWZ5Z216cXFpd2dyY3V5ZHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODg1MTMsImV4cCI6MjA4NTY2NDUxM30.aA7ctMt_GH8rbzWR9vN2tcAdjqHjYqTI5sTuglBcrkI'

type RankRow = {
  id?: string
  date: string
  category: string
  keyword: string
  product_name: string
  coupang_url: string
  rank_today: number
  rank_yesterday: number
  naver_search: number
  image_url?: string
}

// 랭킹 추이 모달
function RankTrendModal({ row, onClose }: { row: RankRow; onClose: () => void }) {
  const [history, setHistory] = useState<{ date: string; rank: number }[]>([])
  useEffect(() => {
    supabase.from('rankings')
      .select('date, rank_today')
      .eq('keyword', row.keyword)
      .eq('product_name', row.product_name)
      .order('date', { ascending: true })
      .limit(90)
      .then(({ data }) => {
        setHistory((data || []).map((r: { date: string; rank_today: number }) => ({ date: r.date.slice(5), rank: r.rank_today })))
      })
  }, [row.keyword, row.product_name])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--card)', borderRadius: 'var(--r12)', padding: 24, width: 'min(600px,95vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>📈 랭킹 추이</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{row.keyword} · {row.product_name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>✕ 닫기</button>
        </div>
        {history.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis reversed tick={{ fontSize: 9 }} width={30} />
              <Tooltip formatter={(val: number) => [`${val}위`, '랭킹']} />
              <Line type="monotone" dataKey="rank" stroke="#3B82F6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>추이 데이터 없음</div>}
      </div>
    </div>
  )
}

export default function RankingPage() {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
  const today = new Date().toISOString().slice(0, 10)

  const [rankings, setRankings] = useState<RankRow[]>([])
  const [loading, setLoading] = useState(true)
  const [trendModal, setTrendModal] = useState<RankRow | null>(null)

  // 추가 폼
  const [addCategory, setAddCategory] = useState('')
  const [addKeyword, setAddKeyword] = useState('')
  const [addProduct, setAddProduct] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [saving, setSaving] = useState(false)

  // 네이버 검색
  const [naverKw, setNaverKw] = useState('')
  const [naverLoading, setNaverLoading] = useState(false)
  const [naverMap, setNaverMap] = useState<Record<string, number>>({})

  useEffect(() => { loadRankings() }, [])

  async function loadRankings() {
    setLoading(true)
    const { data } = await supabase
      .from('rankings')
      .select('*')
      .order('date', { ascending: false })
      .order('rank_today', { ascending: true })
    if (data) {
      // 키워드별 최신 날짜만
      const map = new Map<string, RankRow>()
      ;(data as RankRow[]).forEach(r => {
        const key = `${r.keyword}|${r.product_name}`
        if (!map.has(key)) map.set(key, r)
      })
      setRankings(Array.from(map.values()))
    }
    setLoading(false)
  }

  async function addRanking() {
    if (!addKeyword || !addProduct) return
    setSaving(true)
    await supabase.from('rankings').insert({
      date: today,
      category: addCategory,
      keyword: addKeyword,
      product_name: addProduct,
      coupang_url: addUrl,
      rank_today: 0,
      rank_yesterday: 0,
    })
    setAddCategory(''); setAddKeyword(''); setAddProduct(''); setAddUrl('')
    await loadRankings()
    setSaving(false)
  }

  async function naverLookup() {
    const keywords = naverKw.split(/[,\s]+/).filter(Boolean)
    if (!keywords.length) return
    setNaverLoading(true)
    try {
      const res = await fetch('/api/naver-keywords', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      })
      const json = await res.json()
      const map: Record<string, number> = {}
      ;(json.results || []).forEach((r: { keyword: string; total: number }) => { map[r.keyword] = r.total })
      setNaverMap(prev => ({ ...prev, ...map }))
    } catch { /* ignore */ }
    setNaverLoading(false)
  }

  // 상단 카드 집계
  const rank1 = useMemo(() => rankings.filter(r => r.rank_today === 1), [rankings])
  const rank2_10 = useMemo(() => rankings.filter(r => r.rank_today >= 2 && r.rank_today <= 10), [rankings])
  const rank11_27 = useMemo(() => rankings.filter(r => r.rank_today >= 11 && r.rank_today <= 27), [rankings])
  const rank28_54 = useMemo(() => rankings.filter(r => r.rank_today >= 28 && r.rank_today <= 54), [rankings])

  const kpiCards = [
    { label: '랭킹 1위', count: rank1.length, items: rank1.slice(0, 2).map(r => r.product_name).join(', '), color: 'var(--amber)', ico: '🥇' },
    { label: '2위~10위', count: rank2_10.length, items: rank2_10.slice(0, 2).map(r => r.product_name).join(', '), color: 'var(--blue)', ico: '🥈' },
    { label: '11위~27위', count: rank11_27.length, items: rank11_27.slice(0, 2).map(r => r.product_name).join(', '), color: 'var(--purple)', ico: '📍' },
    { label: '28위~54위', count: rank28_54.length, items: rank28_54.slice(0, 2).map(r => r.product_name).join(', '), color: 'var(--green)', ico: '📌' },
  ]

  return (
    <div>
      {/* 상단 카드 */}
      <div className="krow" style={{ marginBottom: 16 }}>
        {kpiCards.map((c, i) => (
          <div key={i} className={`kpi kc-${['am','bl','pu','gr'][i]}`}>
            <div className="kpi-top"><div className="kpi-ico">{c.ico}</div></div>
            <div className="kpi-lbl">{c.label}</div>
            <div className="kpi-val" style={{ color: c.color, fontSize: 28 }}>{c.count}</div>
            <div className="kpi-foot" style={{ fontSize: 10, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.items || '—'}</div>
          </div>
        ))}
      </div>

      {/* 랭킹 추가 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch"><div className="ch-l"><div className="ch-ico">➕</div><div><div className="ch-title">랭킹 추가</div><div className="ch-sub">키워드 · 상품 등록</div></div></div></div>
        <div className="cb">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 2fr auto', gap: 8, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>분류</div>
              <input className="fi" value={addCategory} onChange={e => setAddCategory(e.target.value)} placeholder="예) 장화" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>키워드</div>
              <input className="fi" value={addKeyword} onChange={e => setAddKeyword(e.target.value)} placeholder="예) 아동 장화" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>상품명 검색</div>
              <input className="fi" value={addProduct} onChange={e => setAddProduct(e.target.value)} placeholder="상품명" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>쿠팡 링크</div>
              <input className="fi" value={addUrl} onChange={e => setAddUrl(e.target.value)} placeholder="https://..." />
            </div>
            <button className="btn-p" onClick={addRanking} disabled={saving || !addKeyword || !addProduct} style={{ height: 36 }}>
              {saving ? '저장중' : '추가'}
            </button>
          </div>
        </div>
      </div>

      {/* 네이버 검색량 조회 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch"><div className="ch-l"><div className="ch-ico">🔎</div><div><div className="ch-title">네이버 검색량</div><div className="ch-sub">키워드 도구 API</div></div></div></div>
        <div className="cb">
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="si" value={naverKw} onChange={e => setNaverKw(e.target.value)} placeholder="키워드 쉼표 구분 입력..." onKeyDown={e => e.key === 'Enter' && naverLookup()} style={{ flex: 1 }} />
            <button className="btn-p" onClick={naverLookup} disabled={naverLoading}>{naverLoading ? '조회중...' : '🔍 조회'}</button>
          </div>
        </div>
      </div>

      {/* 랭킹 현황 테이블 */}
      <div className="card">
        <div className="ch">
          <div className="ch-l"><div className="ch-ico">🏆</div><div><div className="ch-title">랭킹 현황</div><div className="ch-sub">Supabase 데이터 기준</div></div></div>
          <button className="btn-g" onClick={loadRankings} style={{ fontSize: 11, padding: '5px 10px', cursor: 'pointer', border: 'none' }}>🔄 새로고침</button>
        </div>
        <div className="cb">
          {loading ? <div className="empty-st"><div className="es-ico">🏆</div><div className="es-t">로딩 중...</div></div> : (
            <div className="tw" style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 700 }}>
                <thead><tr>
                  <th>분류</th><th>키워드</th><th>이미지</th><th>상품명</th>
                  <th style={{ textAlign: 'right' }}>네이버 검색</th>
                  <th style={{ textAlign: 'right' }}>전주대비</th>
                  <th style={{ textAlign: 'right' }}>어제</th>
                  <th style={{ textAlign: 'right' }}>오늘</th>
                  <th style={{ textAlign: 'center' }}>추이</th>
                </tr></thead>
                <tbody>
                  {rankings.length > 0 ? rankings.map((r, i) => {
                    const diff = r.rank_yesterday && r.rank_today ? r.rank_yesterday - r.rank_today : 0
                    const rc = r.rank_today === 1 ? 'rm1' : r.rank_today <= 3 ? 'rm2' : r.rank_today <= 10 ? 'rm3' : 'rmn'
                    const naverVal = naverMap[r.keyword] || r.naver_search || 0
                    return (
                      <tr key={i}>
                        <td><span className="badge b-bl" style={{ fontSize: 10 }}>{r.category || '—'}</span></td>
                        <td><span className="kw-tag">{r.keyword}</span></td>
                        <td>
                          {r.image_url
                            ? <img src={r.image_url} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            : <div style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>-</div>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{ fontWeight: 700, fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: 'var(--blue)', textDecoration: 'underline dotted' }}
                              onClick={() => setTrendModal(r)}
                              title="클릭 시 추이"
                            >{r.product_name}</span>
                            {r.coupang_url && <a href={r.coupang_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--t3)' }}>🔗</a>}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{naverVal ? fmt(naverVal) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {diff > 0 ? <span style={{ color: 'var(--green)', fontWeight: 800, fontSize: 11 }}>▲{diff}</span>
                            : diff < 0 ? <span style={{ color: 'var(--red, #ef4444)', fontWeight: 800, fontSize: 11 }}>▼{Math.abs(diff)}</span>
                            : <span style={{ color: 'var(--t3)', fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--t3)', fontWeight: 600 }}>{r.rank_yesterday || '—'}</td>
                        <td style={{ textAlign: 'right' }}><span className={`rank-medal ${rc}`}>{r.rank_today || '—'}</span></td>
                        <td style={{ textAlign: 'center' }}>
                          <button onClick={() => setTrendModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 16 }}>📈</button>
                        </td>
                      </tr>
                    )
                  }) : <tr><td colSpan={9}><div className="empty-st"><div className="es-ico">🏆</div><div className="es-t">랭킹 데이터 없음</div></div></td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {trendModal && <RankTrendModal row={trendModal} onClose={() => setTrendModal(null)} />}
    </div>
  )
}

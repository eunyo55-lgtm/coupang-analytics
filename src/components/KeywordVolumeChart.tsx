'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

type VolRow = {
  keyword: string
  target_date: string
  pc_volume: number | null
  mobile_volume: number | null
  total_volume: number | null
}

// 키워드별 최대 N개 색상 순환 (Recharts 라인 색상)
const COLORS = ['#2563eb','#10b981','#f97316','#ef4444','#8b5cf6','#ec4899','#14b8a6','#eab308','#06b6d4','#84cc16']

const ymdKST = (offsetDays = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return k.toISOString().slice(0, 10)
}

export default function KeywordVolumeChart() {
  const [rows, setRows] = useState<VolRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKws, setSelectedKws] = useState<Set<string>>(new Set())
  const [autoSelected, setAutoSelected] = useState(false)
  const [windowDays, setWindowDays] = useState<7 | 14 | 30>(30)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // 최근 60일 데이터 (트렌드/상승률 계산 모두 가능하도록 넉넉히)
        const since = ymdKST(-60)
        const supa = supabase
        if (!supa) return
        const { data, error } = await supa
          .from('keyword_search_volumes')
          .select('keyword, target_date, pc_volume, mobile_volume, total_volume')
          .gte('target_date', since)
          .order('target_date', { ascending: true })
        if (cancelled) return
        if (error) {
          console.warn('[KeywordVolumeChart] load error:', error.message)
          setRows([])
        } else {
          setRows((data as VolRow[]) || [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // 키워드 목록
  const allKeywords = useMemo(() => {
    const s = new Set<string>()
    rows.forEach(r => s.add(r.keyword))
    return Array.from(s).sort()
  }, [rows])

  // 상승률 분석: 최근 7일 평균 vs 이전 7일 평균
  const trendStats = useMemo(() => {
    const recentFrom = ymdKST(-6)   // 오늘 포함 최근 7일
    const recentTo   = ymdKST(0)
    const prevFrom   = ymdKST(-13)
    const prevTo     = ymdKST(-7)

    const acc: Record<string, { recent: number[]; prev: number[]; latest: number; latestDate: string }> = {}
    for (const r of rows) {
      const total = Number(r.total_volume ?? 0)
      const d = r.target_date
      if (!acc[r.keyword]) acc[r.keyword] = { recent: [], prev: [], latest: 0, latestDate: '' }
      if (d >= recentFrom && d <= recentTo) acc[r.keyword].recent.push(total)
      if (d >= prevFrom && d <= prevTo) acc[r.keyword].prev.push(total)
      if (d > acc[r.keyword].latestDate) {
        acc[r.keyword].latestDate = d
        acc[r.keyword].latest = total
      }
    }
    const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
    return Object.entries(acc).map(([kw, v]) => {
      const recentAvg = avg(v.recent)
      const prevAvg = avg(v.prev)
      const delta = recentAvg - prevAvg
      const pct = prevAvg > 0 ? (delta / prevAvg) * 100 : (recentAvg > 0 ? 100 : 0)
      return {
        keyword: kw,
        latest: v.latest,
        latestDate: v.latestDate,
        recentAvg: Math.round(recentAvg),
        prevAvg: Math.round(prevAvg),
        delta: Math.round(delta),
        pct: Math.round(pct * 10) / 10,
      }
    }).sort((a, b) => b.pct - a.pct)
  }, [rows])

  // 데이터가 로드되면 상위 상승 키워드 5개 자동 선택 (사용자가 변경 가능)
  useEffect(() => {
    if (!autoSelected && trendStats.length > 0) {
      const top = trendStats
        .filter(s => s.recentAvg > 0)
        .slice(0, 5)
        .map(s => s.keyword)
      setSelectedKws(new Set(top))
      setAutoSelected(true)
    }
  }, [trendStats, autoSelected])

  // 라인 차트용 데이터: [{ date, kwA: 1234, kwB: 567, ... }, ...]
  const chartData = useMemo(() => {
    const since = ymdKST(-windowDays)
    const byDate: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      if (r.target_date < since) continue
      if (!selectedKws.has(r.keyword)) continue
      if (!byDate[r.target_date]) byDate[r.target_date] = {}
      byDate[r.target_date][r.keyword] = Number(r.total_volume ?? 0)
    }
    // 주의: 키워드 데이터를 먼저 펼치고 date를 마지막에 추가 (date 키 덮어쓰기 방지)
    return Object.entries(byDate)
      .map(([date, kvs]) => ({ ...kvs, date: date.slice(5) }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [rows, selectedKws, windowDays])

  const visibleKws = useMemo(() => Array.from(selectedKws), [selectedKws])

  function toggleKw(kw: string) {
    setSelectedKws(prev => {
      const next = new Set(prev)
      if (next.has(kw)) next.delete(kw); else next.add(kw)
      return next
    })
  }

  function applyTopRisers(n: number) {
    const top = trendStats
      .filter(s => s.recentAvg > 0)
      .slice(0, n)
      .map(s => s.keyword)
    setSelectedKws(new Set(top))
  }

  if (loading) {
    return (
      <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, padding:16, marginBottom:16 }}>
        <div style={{ fontSize:14, color:'#64748b' }}>네이버 검색량 데이터를 불러오는 중...</div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, padding:16, marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:600, color:'#0f172a', marginBottom:6 }}>🔍 네이버 검색량</div>
        <div style={{ fontSize:12, color:'#64748b' }}>
          아직 수집된 데이터가 없습니다. 네이버 봇을 한 번 실행하면 표시됩니다.
        </div>
      </div>
    )
  }

  return (
    <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, padding:16, marginBottom:16 }}>
      {/* 헤더 */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'#0f172a' }}>🔍 네이버 키워드 검색량 추이</div>
          <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
            등록된 키워드 {allKeywords.length}개 · 최근 60일 데이터
          </div>
        </div>
        <div style={{ display:'flex', gap:6, fontSize:11 }}>
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setWindowDays(d as 7 | 14 | 30)}
              style={{
                padding:'4px 10px', borderRadius:6, fontWeight:600, cursor:'pointer',
                background: windowDays === d ? '#10b981' : '#f1f5f9',
                color: windowDays === d ? 'white' : '#475569',
                border: 'none',
              }}
            >{d}일</button>
          ))}
        </div>
      </div>

      {/* 상승 키워드 분석 표 */}
      <details open style={{ marginBottom:14 }}>
        <summary style={{ cursor:'pointer', fontSize:12, fontWeight:600, color:'#475569', marginBottom:8 }}>
          📈 상승 키워드 TOP 10 (최근 7일 vs 이전 7일)
        </summary>
        <div style={{ overflowX:'auto', marginTop:8 }}>
          <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse', minWidth:500 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                <th style={{ padding:'6px 8px', textAlign:'left', fontWeight:600, color:'#475569' }}>키워드</th>
                <th style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#475569' }}>최근 7일 평균</th>
                <th style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#475569' }}>이전 7일 평균</th>
                <th style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#475569' }}>증감</th>
                <th style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#475569' }}>변동률</th>
                <th style={{ padding:'6px 8px', textAlign:'center', fontWeight:600, color:'#475569' }}></th>
              </tr>
            </thead>
            <tbody>
              {trendStats.slice(0, 10).map(s => {
                const up = s.pct > 0
                const flat = s.pct === 0
                const pctColor = flat ? '#94a3b8' : (up ? '#059669' : '#dc2626')
                return (
                  <tr key={s.keyword} style={{ borderTop:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'6px 8px', color:'#0f172a' }}>{s.keyword}</td>
                    <td style={{ padding:'6px 8px', textAlign:'right', color:'#334155' }}>{s.recentAvg.toLocaleString()}</td>
                    <td style={{ padding:'6px 8px', textAlign:'right', color:'#64748b' }}>{s.prevAvg.toLocaleString()}</td>
                    <td style={{ padding:'6px 8px', textAlign:'right', color:'#334155' }}>{s.delta >= 0 ? '+' : ''}{s.delta.toLocaleString()}</td>
                    <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color: pctColor }}>
                      {flat ? '0%' : `${up ? '▲' : '▼'} ${Math.abs(s.pct).toFixed(1)}%`}
                    </td>
                    <td style={{ padding:'6px 8px', textAlign:'center' }}>
                      <button
                        onClick={() => toggleKw(s.keyword)}
                        style={{
                          background: selectedKws.has(s.keyword) ? '#dbeafe' : 'transparent',
                          color: selectedKws.has(s.keyword) ? '#1e40af' : '#64748b',
                          border: '1px solid #cbd5e1', borderRadius:4, padding:'2px 8px',
                          fontSize:10, cursor:'pointer',
                        }}
                      >
                        {selectedKws.has(s.keyword) ? '차트표시 중' : '차트추가'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>

      {/* 차트 컨트롤 */}
      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, marginBottom:8, flexWrap:'wrap' }}>
        <span style={{ color:'#64748b', fontWeight:600 }}>차트 표시:</span>
        <button onClick={() => applyTopRisers(5)} style={btnStyle()}>상승 TOP 5</button>
        <button onClick={() => applyTopRisers(10)} style={btnStyle()}>상승 TOP 10</button>
        <button onClick={() => setSelectedKws(new Set())} style={btnStyle()}>전체 해제</button>
        <span style={{ color:'#94a3b8', marginLeft:'auto' }}>선택 {visibleKws.length}/{allKeywords.length}</span>
      </div>

      {/* 라인 차트 */}
      <div style={{ width:'100%', height:300 }}>
        {visibleKws.length === 0 ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94a3b8', fontSize:13 }}>
            상단 표에서 키워드를 선택하거나 &quot;상승 TOP 5&quot; 버튼을 눌러주세요.
          </div>
        ) : (
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top:8, right:16, left:0, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize:10, fill:'#64748b' }} />
              <YAxis tick={{ fontSize:10, fill:'#64748b' }} tickFormatter={(v) => v >= 10000 ? `${Math.round(v/1000)}k` : String(v)} />
              <Tooltip
                contentStyle={{ fontSize:11, borderRadius:6, border:'1px solid #e2e8f0' }}
                formatter={(value: number | string) => Number(value).toLocaleString()}
              />
              <Legend wrapperStyle={{ fontSize:11 }} />
              {visibleKws.map((kw, i) => (
                <Line
                  key={kw}
                  type="monotone"
                  dataKey={kw}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function btnStyle(): React.CSSProperties {
  return {
    padding:'4px 10px', background:'#f1f5f9', color:'#475569',
    border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer',
  }
}

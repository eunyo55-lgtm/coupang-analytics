'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

type VolRow = {
  keyword: string
  target_date: string
  total_volume: number | null
}

const COLORS = ['#2563eb','#10b981','#f97316','#ef4444','#8b5cf6','#ec4899','#14b8a6','#eab308','#06b6d4','#84cc16']

const ymdKST = (offsetDays = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return k.toISOString().slice(0, 10)
}

/**
 * 관리 중인 키워드의 네이버 검색량 추이 그래프.
 * 사용자가 직접 추적 중인 키워드(`keywords` 테이블에 등록된 것)만 표시한다.
 * 기본적으로 최근 검색량 상위 8개 자동 선택, 사용자가 체크박스로 더하거나 뺄 수 있음.
 */
export default function KeywordVolumeChart() {
  const [rows, setRows] = useState<VolRow[]>([])
  const [trackedKeywords, setTrackedKeywords] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKws, setSelectedKws] = useState<Set<string>>(new Set())
  const [autoSelected, setAutoSelected] = useState(false)
  const [windowDays, setWindowDays] = useState<7 | 14 | 30 | 60>(30)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        if (!supabase) return
        // 1) 관리 중인 키워드 목록
        const { data: kwData } = await supabase
          .from('keywords')
          .select('keyword')
        const tracked = Array.from(new Set((kwData ?? []).map((k: any) => k.keyword as string).filter(Boolean)))
        if (cancelled) return
        setTrackedKeywords(tracked)

        // 2) 최근 60일치 검색량 (관리 키워드만)
        if (tracked.length === 0) {
          setRows([])
          return
        }
        const since = ymdKST(-60)
        const { data, error } = await supabase
          .from('keyword_search_volumes')
          .select('keyword, target_date, total_volume')
          .in('keyword', tracked)
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

  // 키워드별 최신/최근 평균 검색량 (자동 선택 기준)
  const keywordRanking = useMemo(() => {
    const acc: Record<string, { sum: number; count: number; latest: number; latestDate: string }> = {}
    for (const r of rows) {
      const total = Number(r.total_volume ?? 0)
      if (!acc[r.keyword]) acc[r.keyword] = { sum: 0, count: 0, latest: 0, latestDate: '' }
      acc[r.keyword].sum += total
      acc[r.keyword].count++
      if (r.target_date > acc[r.keyword].latestDate) {
        acc[r.keyword].latestDate = r.target_date
        acc[r.keyword].latest = total
      }
    }
    return Object.entries(acc)
      .map(([k, v]) => ({ keyword: k, avg: v.count ? v.sum / v.count : 0, latest: v.latest }))
      .sort((a, b) => b.avg - a.avg)
  }, [rows])

  // 데이터 로드 후 상위 8개 자동 선택 (사용자가 변경 가능)
  useEffect(() => {
    if (!autoSelected && keywordRanking.length > 0) {
      setSelectedKws(new Set(keywordRanking.slice(0, 8).map(k => k.keyword)))
      setAutoSelected(true)
    }
  }, [keywordRanking, autoSelected])

  // 차트 데이터 — date 키 덮어쓰기 방지 위해 spread 먼저, date 마지막
  const chartData = useMemo(() => {
    const since = ymdKST(-windowDays)
    const byDate: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      if (r.target_date < since) continue
      if (!selectedKws.has(r.keyword)) continue
      if (!byDate[r.target_date]) byDate[r.target_date] = {}
      byDate[r.target_date][r.keyword] = Number(r.total_volume ?? 0)
    }
    return Object.entries(byDate)
      .map(([date, kvs]) => ({ ...kvs, date: date.slice(5) }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [rows, selectedKws, windowDays])

  function toggleKw(kw: string) {
    setSelectedKws(prev => {
      const next = new Set(prev)
      if (next.has(kw)) next.delete(kw); else next.add(kw)
      return next
    })
  }
  function selectTopN(n: number) {
    setSelectedKws(new Set(keywordRanking.slice(0, n).map(k => k.keyword)))
  }
  function clearAll() {
    setSelectedKws(new Set())
  }

  if (loading) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ padding: 16, fontSize: 13, color: '#64748b' }}>관리 중인 키워드 검색량을 불러오는 중...</div>
      </div>
    )
  }

  if (trackedKeywords.length === 0) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>📈 관리 중인 키워드 검색량 추이</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>아직 추적 중인 키워드가 없습니다. 위에서 키워드를 추가하세요.</div>
        </div>
      </div>
    )
  }

  const visibleKws = Array.from(selectedKws)

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="ch">
        <div className="ch-l">
          <div className="ch-ico">📈</div>
          <div>
            <div className="ch-title">관리 키워드 검색량 추이</div>
            <div className="ch-sub">
              관리 중인 {trackedKeywords.length}개 키워드 · 네이버 일별 검색량
            </div>
          </div>
        </div>
        <div className="ch-r" style={{ display: 'flex', gap: 6 }}>
          {[7, 14, 30, 60].map(d => (
            <button
              key={d}
              onClick={() => setWindowDays(d as 7 | 14 | 30 | 60)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 11,
                background: windowDays === d ? '#10b981' : '#f1f5f9',
                color: windowDays === d ? 'white' : '#475569',
                border: 'none',
              }}
            >{d}일</button>
          ))}
        </div>
      </div>

      <div className="cb">
        {/* 차트 표시 컨트롤 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 10 }}>
          <span style={{ color: '#64748b', fontWeight: 600, marginRight: 4 }}>빠른 선택:</span>
          <button onClick={() => selectTopN(5)} style={chipStyle()}>상위 5</button>
          <button onClick={() => selectTopN(8)} style={chipStyle()}>상위 8</button>
          <button onClick={() => selectTopN(15)} style={chipStyle()}>상위 15</button>
          <button onClick={clearAll} style={chipStyle()}>전체 해제</button>
          <span style={{ color: '#94a3b8', marginLeft: 'auto' }}>표시 중 {visibleKws.length}/{trackedKeywords.length}</span>
        </div>

        {/* 차트 */}
        <div style={{ width: '100%', height: 320 }}>
          {visibleKws.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 13 }}>
              아래 키워드 목록에서 선택하거나 &quot;상위 N&quot; 버튼을 눌러주세요.
            </div>
          ) : chartData.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 13 }}>
              선택한 키워드의 검색량 데이터가 아직 없습니다. 네이버 봇이 한 번 더 실행되면 표시됩니다.
            </div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v) => v >= 10000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }} formatter={(value: number | string) => Number(value).toLocaleString()} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
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

        {/* 키워드 토글 목록 (체크박스 식) */}
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {keywordRanking.map(({ keyword, latest }) => {
            const on = selectedKws.has(keyword)
            return (
              <button
                key={keyword}
                onClick={() => toggleKw(keyword)}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: on ? '1px solid #2563eb' : '1px solid #e2e8f0',
                  background: on ? '#dbeafe' : 'white',
                  color: on ? '#1e40af' : '#475569',
                }}
                title={`최신: ${latest.toLocaleString()}`}
              >
                {on ? '✓ ' : ''}{keyword}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function chipStyle(): React.CSSProperties {
  return {
    padding: '4px 10px', background: '#f1f5f9', color: '#475569',
    border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  }
}

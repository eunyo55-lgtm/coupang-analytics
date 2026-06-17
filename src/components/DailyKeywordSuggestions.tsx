'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type DailyRow = {
  id: string
  date: string
  keyword: string
  total_volume: number
  pc_volume: number
  mobile_volume: number
  competition: string
  source_seed: string
  has_age_token: boolean
  is_surging: boolean
  wow_delta: number | null
  dismissed: boolean
  registered: boolean
}

type Props = {
  existingKeywords: string[]
  onRegisterClick: (keyword: string, sourceSeed: string) => void
  onRegistered: () => void
}

export default function DailyKeywordSuggestions({ existingKeywords, onRegisterClick, onRegistered }: Props) {
  const [rows, setRows] = useState<DailyRow[]>([])
  const [date, setDate] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)  // 매일 아침 추천은 기본 펼침

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      try {
        // 가장 최근 날짜의 추천 가져옴
        const { data: dateRow } = await supabase
          .from('daily_keyword_suggestions')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
        const latestDate = (dateRow?.[0] as any)?.date
        if (!latestDate || cancelled) {
          setLoading(false)
          return
        }
        setDate(latestDate)
        const { data } = await supabase
          .from('daily_keyword_suggestions')
          .select('*')
          .eq('date', latestDate)
          .eq('dismissed', false)
          .eq('registered', false)
          .order('has_age_token', { ascending: false })
          .order('total_volume', { ascending: false })
          .limit(40)
        if (cancelled) return
        setRows((data || []) as DailyRow[])
      } catch (e) {
        console.warn('[DailyKeyword] load failed:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  async function dismiss(id: string) {
    if (!supabase) return
    setRows(prev => prev.filter(r => r.id !== id))
    await supabase.from('daily_keyword_suggestions').update({ dismissed: true }).eq('id', id)
  }

  async function markRegistered(id: string) {
    if (!supabase) return
    await supabase.from('daily_keyword_suggestions').update({ registered: true }).eq('id', id)
    setRows(prev => prev.filter(r => r.id !== id))
    onRegistered()
  }

  const existSet = new Set(existingKeywords.map(k => k.toLowerCase().trim()))
  const filtered = rows.filter(r => !existSet.has(r.keyword.toLowerCase().trim()))

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch">
          <div className="ch-l">
            <div className="ch-ico">☀️</div>
            <div>
              <div className="ch-title">오늘의 자동 추천 키워드</div>
              <div className="ch-sub">불러오는 중...</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (filtered.length === 0) return null

  const targetHit = filtered.filter(r => r.has_age_token)
  const ageNeutral = filtered.filter(r => !r.has_age_token)

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div className="ch-l">
          <div className="ch-ico">☀️</div>
          <div>
            <div className="ch-title">
              오늘의 자동 추천 키워드 {open ? '▼' : '▶'}
              <span style={{
                marginLeft: 8, fontSize: 10, fontWeight: 700,
                background: '#DBEAFE', color: '#1E40AF',
                padding: '2px 8px', borderRadius: 999,
              }}>
                {filtered.length}개 · 🎯 {targetHit.length}개
              </span>
            </div>
            <div className="ch-sub">매일 아침 자동 발굴 · 기준일 {date}</div>
          </div>
        </div>
      </div>

      {open && (
        <div className="cb">
          <div style={{
            border: '1px solid #E4E7EC', borderRadius: 6,
            maxHeight: 360, overflowY: 'auto',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
                <tr>
                  <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #E4E7EC', width: 50 }}>적합</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #E4E7EC' }}>키워드</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #E4E7EC' }}>월 검색량</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #E4E7EC' }}>경쟁</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #E4E7EC' }}>출처</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #E4E7EC', width: 140 }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {[...targetHit, ...ageNeutral].map(r => {
                  const compColor = r.competition === 'high' ? '#DC2626' : r.competition === 'mid' ? '#D97706' : '#059669'
                  const compLabel = r.competition === 'high' ? '높음' : r.competition === 'mid' ? '중간' : '낮음'
                  return (
                    <tr key={r.id} style={{
                      borderTop: '1px solid #F3F4F6',
                      background: r.has_age_token ? undefined : '#FFFBEB',
                      opacity: r.has_age_token ? 1 : 0.85,
                    }}>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <span style={{ fontSize: 14 }}>{r.has_age_token ? '🎯' : '⚠️'}</span>
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                        {r.is_surging && <span style={{ marginRight: 4, fontSize: 13 }} title={`전주 대비 +${r.wow_delta}%`}>🔥</span>}
                        {r.keyword}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>
                        {r.total_volume.toLocaleString('ko-KR')}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: compColor,
                          padding: '2px 6px', borderRadius: 4, background: compColor + '15',
                        }}>{compLabel}</span>
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--t3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.source_seed}>
                        {r.source_seed}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <button
                          onClick={() => {
                            onRegisterClick(r.keyword, r.source_seed)
                            markRegistered(r.id)
                          }}
                          style={{
                            padding: '4px 8px', fontSize: 11, borderRadius: 4,
                            background: '#1570EF', color: '#fff', border: 'none', fontWeight: 700,
                            cursor: 'pointer', marginRight: 4,
                          }}
                        >+ 등록</button>
                        <button
                          onClick={() => dismiss(r.id)}
                          style={{
                            padding: '4px 8px', fontSize: 11, borderRadius: 4,
                            background: '#fff', color: 'var(--t3)', border: '1px solid #E4E7EC',
                            fontWeight: 600, cursor: 'pointer',
                          }}
                          title="관심없음 — 다시 표시 안 함"
                        >×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

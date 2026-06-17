'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Catalog = {
  id: number
  category_path: string
  category_id: string | null
  category_url: string
  active: boolean
  display_order: number
}

type RankingRow = {
  id: string
  catalog_id: number
  measured_date: string
  position: number
  coupang_product_id: string
  product_name: string | null
  product_image: string | null
  vendor_name: string | null
  is_our_product: boolean
  matched_barcode: string | null
}

export default function CategoryRankingSection() {
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [rankings, setRankings] = useState<RankingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)  // 카테고리 탭에서 기본 펼침
  const [showAdd, setShowAdd] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [newUrl, setNewUrl] = useState('')
  // 편집 모달
  const [editing, setEditing] = useState<Catalog | null>(null)
  const [editPath, setEditPath] = useState('')
  const [editUrl, setEditUrl] = useState('')

  async function load() {
    if (!supabase) return
    setLoading(true)
    try {
      const { data: cats } = await supabase
        .from('coupang_category_catalog')
        .select('*')
        .eq('active', true)
        .order('display_order')
        .order('category_path')
      setCatalogs((cats || []) as Catalog[])

      // 가장 최근 측정일의 랭킹 가져옴
      const { data: latest } = await supabase
        .from('coupang_category_rankings')
        .select('measured_date')
        .order('measured_date', { ascending: false })
        .limit(1)
      const latestDate = (latest?.[0] as any)?.measured_date
      if (latestDate) {
        const { data: ranks } = await supabase
          .from('coupang_category_rankings')
          .select('*')
          .eq('measured_date', latestDate)
          .order('position', { ascending: true })
        setRankings((ranks || []) as RankingRow[])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function addCatalog() {
    if (!supabase) return
    const path = newPath.trim()
    const url = newUrl.trim()
    if (!path || !url) { alert('카테고리 경로와 URL을 모두 입력해주세요'); return }
    // URL 에서 category_id 추출 (https://...categories/12345)
    const m = url.match(/\/categories\/(\d+)/)
    const categoryId = m?.[1] || null
    const { error } = await supabase.from('coupang_category_catalog').insert([{
      category_path: path,
      category_url: url,
      category_id: categoryId,
      active: true,
    }])
    if (error) { alert('등록 실패: ' + error.message); return }
    setNewPath(''); setNewUrl(''); setShowAdd(false)
    load()
  }

  async function removeCatalog(id: number) {
    if (!supabase) return
    if (!confirm('이 카테고리를 추적 목록에서 제거하시겠어요?')) return
    await supabase.from('coupang_category_catalog').update({ active: false }).eq('id', id)
    load()
  }

  const [triggering, setTriggering] = useState(false)
  // 카테고리 추적 job 상태 자동 폴링
  const [jobStatus, setJobStatus] = useState<'pending'|'running'|'completed'|'failed'|null>(null)
  const [jobStartedAt, setJobStartedAt] = useState<string | null>(null)
  const [jobFinishedAt, setJobFinishedAt] = useState<string | null>(null)
  const [justCompleted, setJustCompleted] = useState(false)
  const lastStatusRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function poll() {
      if (!supabase || cancelled) return
      try {
        const { data } = await supabase
          .from('ranking_jobs')
          .select('status, started_at, finished_at')
          .eq('job_type', 'coupang_category')
          .order('created_at', { ascending: false })
          .limit(1)
        if (cancelled) return
        const j = (data?.[0] as any)
        const s = j?.status ?? null
        setJobStatus(s)
        setJobStartedAt(j?.started_at ?? null)
        setJobFinishedAt(j?.finished_at ?? null)
        // 진행 중 → 완료 전이 감지: 데이터 자동 reload + 완료 플래시
        if ((lastStatusRef.current === 'pending' || lastStatusRef.current === 'running')
            && s === 'completed') {
          setJustCompleted(true)
          load()
          setTimeout(() => setJustCompleted(false), 8000)
        }
        lastStatusRef.current = s
      } catch { /* ignore */ }
      // 진행 중이면 5초, 아니면 30초 폴링
      const next = (s => s === 'pending' || s === 'running' ? 5000 : 30000)(lastStatusRef.current)
      timer = setTimeout(poll, next)
    }
    poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  // load 함수는 컴포넌트 lifetime 동안 안정적이라 의존성 제외
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function triggerCategoryScan() {
    if (!supabase) return
    if (catalogs.length === 0) { alert('추적 카테고리가 없습니다. 먼저 등록해주세요.'); return }
    setTriggering(true)
    try {
      const { error } = await supabase.from('ranking_jobs').insert([{
        job_type: 'coupang_category',
        triggered_by: 'dashboard',
        status: 'pending',
      }])
      if (error) { alert('트리거 실패: ' + error.message); return }
      alert(`✅ 카테고리 추적 작업이 대기열에 등록됐어요.\n회사 PC의 runner.js 가 15초 안에 가져갑니다.\n완료 후 새로고침하면 결과 표시됨.`)
    } finally {
      setTriggering(false)
    }
  }

  function openEdit(c: Catalog) {
    setEditing(c)
    setEditPath(c.category_path)
    setEditUrl(c.category_url)
  }

  async function saveEdit() {
    if (!supabase || !editing) return
    const path = editPath.trim()
    const url = editUrl.trim()
    if (!path || !url) { alert('카테고리 경로와 URL을 모두 입력해주세요'); return }
    const m = url.match(/\/categories\/(\d+)/)
    const categoryId = m?.[1] || null
    const { error } = await supabase
      .from('coupang_category_catalog')
      .update({
        category_path: path,
        category_url: url,
        category_id: categoryId,
      })
      .eq('id', editing.id)
    if (error) { alert('수정 실패: ' + error.message); return }
    setEditing(null)
    load()
  }

  // 각 카탈로그별 우리 상품 노출 통계
  const statsByCatalog = useMemo(() => {
    const m = new Map<number, { ourCount: number; ourPositions: number[]; totalSeen: number; latestDate?: string }>()
    for (const r of rankings) {
      const cur = m.get(r.catalog_id) || { ourCount: 0, ourPositions: [], totalSeen: 0 }
      cur.totalSeen++
      if (r.is_our_product) {
        cur.ourCount++
        cur.ourPositions.push(r.position)
      }
      if (!cur.latestDate || r.measured_date > cur.latestDate) cur.latestDate = r.measured_date
      m.set(r.catalog_id, cur)
    }
    return m
  }, [rankings])

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div className="ch-l">
          <div className="ch-ico">📂</div>
          <div>
            <div className="ch-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>카테고리 1페이지 우리 상품 노출 추적 {open ? '▼' : '▶'}</span>
              {/* 실시간 진행 상태 배지 */}
              {(jobStatus === 'pending' || jobStatus === 'running') && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                  background: '#3B82F6', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  animation: 'pulse-blue 1.6s ease-in-out infinite',
                }}>
                  <style>{`@keyframes pulse-blue { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }`}</style>
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: '#fff',
                    animation: 'spin-blue 1s linear infinite',
                  }} />
                  <style>{`@keyframes spin-blue { 0% { transform: scale(1); } 50% { transform: scale(1.5); } 100% { transform: scale(1); } }`}</style>
                  🤖 추적 중...
                </span>
              )}
              {justCompleted && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                  background: '#10B981', color: '#fff',
                  animation: 'pulse-green 0.8s ease-in-out',
                }}>
                  <style>{`@keyframes pulse-green { 0% { transform: scale(0.8); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }`}</style>
                  ✅ 방금 완료
                </span>
              )}
            </div>
            <div className="ch-sub">
              {catalogs.length}개 카테고리 · 판매량순 정렬 (PC/모바일 디바이스 차이 제거) ·
              {rankings.length > 0 ? ` 우리 상품 ${rankings.filter(r => r.is_our_product).length}개 노출 중` : ' 데이터 대기'}
              {(jobStatus === 'running' && jobStartedAt) && (
                <span style={{ marginLeft: 6, color: '#3B82F6', fontWeight: 600 }}>
                  · 시작 {new Date(new Date(jobStartedAt).getTime() + 9*3600000).toISOString().slice(11, 16)}
                </span>
              )}
              {(jobStatus === 'completed' && jobFinishedAt && !justCompleted) && (
                <span style={{ marginLeft: 6, color: '#10B981', fontWeight: 600 }}>
                  · 최근 추적 {new Date(new Date(jobFinishedAt).getTime() + 9*3600000).toISOString().slice(5, 16).replace('T', ' ')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {open && (
        <div className="cb">
          {/* 추적 카테고리 목록 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>📋 추적 카테고리</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={triggerCategoryScan}
                  disabled={triggering || catalogs.length === 0}
                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 4,
                    background: triggering || catalogs.length === 0 ? '#94A3B8' : '#7C3AED',
                    color: '#fff', border: 'none', fontWeight: 700,
                    cursor: triggering || catalogs.length === 0 ? 'not-allowed' : 'pointer' }}
                  title="상단 🤖 데이터 수집 으로 일괄 실행 가능 · 이 버튼은 카테고리만 단독 재실행"
                >{triggering ? '⏳ 대기 중' : '📂 카테고리만 단독 실행'}</button>
                <button
                  onClick={() => setShowAdd(!showAdd)}
                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 4,
                    background: '#1570EF', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                >{showAdd ? '취소' : '+ 카테고리 추가'}</button>
              </div>
            </div>

            {showAdd && (
              <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 6, marginBottom: 8 }}>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>카테고리 경로 (표시용)</label>
                  <input
                    value={newPath}
                    onChange={e => setNewPath(e.target.value)}
                    placeholder="패션의류 > 키즈의류 > 상의류 > 티셔츠"
                    style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #E4E7EC', borderRadius: 4 }}
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>쿠팡 카테고리 URL</label>
                  <input
                    value={newUrl}
                    onChange={e => setNewUrl(e.target.value)}
                    placeholder="https://www.coupang.com/np/categories/195530"
                    style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #E4E7EC', borderRadius: 4 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                    💡 쿠팡에서 카테고리 진입 후 주소창의 URL 을 복사
                  </div>
                </div>
                <button
                  onClick={addCatalog}
                  style={{ padding: '6px 16px', fontSize: 12, borderRadius: 4,
                    background: '#0F172A', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                >등록</button>
              </div>
            )}

            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--t3)', padding: 10 }}>로딩 중...</div>
            ) : catalogs.length === 0 ? (
              <div style={{
                padding: 16, background: '#F8FAFC', borderRadius: 6, textAlign: 'center',
                fontSize: 12, color: 'var(--t3)',
              }}>
                추적 중인 카테고리가 없습니다. 위 "+ 카테고리 추가" 로 등록해주세요.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8 }}>
                {catalogs.map(c => {
                  const st = statsByCatalog.get(c.id)
                  return (
                    <div key={c.id} style={{
                      padding: 10, border: '1px solid #E4E7EC', borderRadius: 6, background: '#fff',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                        <a
                          href={c.category_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 11, fontWeight: 600, color: '#1570EF', textDecoration: 'none', flex: 1 }}
                        >{c.category_path}</a>
                        <button
                          onClick={() => openEdit(c)}
                          title="카테고리 정보 수정"
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: '#94A3B8', fontSize: 12, padding: 0, lineHeight: 1,
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#1570EF'}
                          onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                        >✏️</button>
                        <button
                          onClick={() => removeCatalog(c.id)}
                          title="추적 중지"
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: '#94A3B8', fontSize: 14, padding: 0, lineHeight: 1,
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                          onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                        >×</button>
                      </div>
                      {st ? (
                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--t3)' }}>
                          {st.latestDate && (
                            <div>측정일: <b>{st.latestDate}</b></div>
                          )}
                          <div style={{ marginTop: 2 }}>
                            우리 상품 노출: <b style={{
                              color: st.ourCount > 0 ? '#059669' : '#DC2626',
                              fontSize: 14,
                            }}>{st.ourCount}개</b>
                            {st.ourCount > 0 && (
                              <span style={{ marginLeft: 4 }}>
                                — 위치 {st.ourPositions.slice(0, 5).join(', ')}
                                {st.ourPositions.length > 5 ? '...' : ''}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, marginTop: 2, color: 'var(--t3)' }}>
                            1페이지 {st.totalSeen}개 중
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 6, fontSize: 10, color: '#94A3B8', fontStyle: 'italic' }}>
                          📭 데이터 대기 — 봇 크롤링 후 표시
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 우리 상품 노출 상세 (모든 카탈로그 합산) */}
          {rankings.filter(r => r.is_our_product).length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>
                🎯 우리 상품 1페이지 노출 상세
              </div>
              <div style={{ border: '1px solid #E4E7EC', borderRadius: 6, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead style={{ background: '#F9FAFB' }}>
                    <tr>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #E4E7EC' }}>카테고리</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #E4E7EC', width: 60 }}>위치</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #E4E7EC' }}>상품명</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.filter(r => r.is_our_product).map(r => {
                      const cat = catalogs.find(c => c.id === r.catalog_id)
                      const posColor = r.position <= 10 ? '#059669' : r.position <= 30 ? '#D97706' : '#64748B'
                      return (
                        <tr key={r.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                          <td style={{ padding: '6px 10px', fontSize: 10, color: 'var(--t3)' }}>
                            {cat?.category_path.split(' > ').slice(-1)[0] || '?'}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: posColor }}>{r.position}</span>
                          </td>
                          <td style={{ padding: '6px 10px' }}>{r.product_name || '(상품명 없음)'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 편집 모달 */}
      {editing && (
        <div
          onClick={() => setEditing(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 10, padding: 24,
              width: '92%', maxWidth: 520, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>✏️ 카테고리 정보 수정</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>카테고리 경로 (표시용)</label>
              <input
                value={editPath}
                onChange={e => setEditPath(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #E4E7EC', borderRadius: 6 }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>쿠팡 카테고리 URL</label>
              <input
                value={editUrl}
                onChange={e => setEditUrl(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #E4E7EC', borderRadius: 6 }}
              />
              <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                URL 의 /categories/숫자 에서 카테고리 ID 자동 추출
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditing(null)}
                style={{ padding: '8px 16px', borderRadius: 6, background: '#fff',
                  color: 'var(--t2)', border: '1px solid #E4E7EC', fontWeight: 600,
                  fontSize: 13, cursor: 'pointer' }}
              >취소</button>
              <button
                onClick={saveEdit}
                style={{ padding: '8px 16px', borderRadius: 6, background: '#1570EF',
                  color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

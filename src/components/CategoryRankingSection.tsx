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

      // 최근 N일(기본 14일) 의 우리 상품 노출 데이터를 모두 가져옴 (일별 추이용)
      // PostgREST max-rows 1000 → 페이지네이션
      const since = (() => {
        const d = new Date(); d.setDate(d.getDate() - 13)
        return d.toISOString().slice(0, 10)
      })()
      const all: RankingRow[] = []
      let off = 0
      while (true) {
        const { data, error } = await supabase
          .from('coupang_category_rankings')
          .select('*')
          .gte('measured_date', since)
          .order('measured_date', { ascending: true })
          .range(off, off + 999)
        if (error) break
        const rows = (data || []) as RankingRow[]
        all.push(...rows)
        if (rows.length < 1000) break
        off += 1000
        if (off > 30000) break
      }
      setRankings(all)
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

  // 가장 최근 측정일
  const latestDate = useMemo(() => {
    let max = ''
    for (const r of rankings) if (r.measured_date > max) max = r.measured_date
    return max
  }, [rankings])

  // 표시할 날짜 컬럼 (최근 7일, 측정 데이터 있는 것만)
  const dateColumns = useMemo(() => {
    const set = new Set<string>()
    for (const r of rankings) set.add(r.measured_date)
    return Array.from(set).sort().slice(-7)  // 최근 7일까지
  }, [rankings])

  // 각 카탈로그별 우리 상품 노출 통계 (최신일 기준)
  const statsByCatalog = useMemo(() => {
    const m = new Map<number, { ourCount: number; ourPositions: number[]; totalSeen: number; latestDate?: string }>()
    for (const r of rankings) {
      if (r.measured_date !== latestDate) continue  // 최신일 기준
      const cur = m.get(r.catalog_id) || { ourCount: 0, ourPositions: [], totalSeen: 0 }
      cur.totalSeen++
      if (r.is_our_product) {
        cur.ourCount++
        cur.ourPositions.push(r.position)
      }
      cur.latestDate = r.measured_date
      m.set(r.catalog_id, cur)
    }
    return m
  }, [rankings, latestDate])

  // 일별 추이 — (카탈로그 × 상품) 단위로 묶기
  // 한 카테고리에 여러 우리 상품이 있어도 각각 별도 행
  type TrendRow = {
    catalogId: number
    productId: string
    productName: string
    productImage: string
    positionByDate: Record<string, number>   // 날짜 → 그 날의 position
    latestPosition: number                    // 정렬용
  }
  const trendRows = useMemo<TrendRow[]>(() => {
    const m = new Map<string, TrendRow>()
    for (const r of rankings) {
      if (!r.is_our_product) continue
      const key = `${r.catalog_id}__${r.coupang_product_id}`
      const cur = m.get(key) || {
        catalogId: r.catalog_id,
        productId: r.coupang_product_id,
        productName: r.product_name || '',
        productImage: r.product_image || '',
        positionByDate: {},
        latestPosition: 999,
      }
      cur.positionByDate[r.measured_date] = r.position
      // 가장 최근 날짜의 product_name/image 로 업데이트
      if (r.measured_date === latestDate) {
        if (r.product_name) cur.productName = r.product_name
        if (r.product_image) cur.productImage = r.product_image
        cur.latestPosition = r.position
      }
      m.set(key, cur)
    }
    return Array.from(m.values()).sort((a, b) => a.latestPosition - b.latestPosition)
  }, [rankings, latestDate])

  // 순위 등급별 노출 아이템 수 (최신일 기준, 우리 상품만)
  const tierStats = useMemo(() => {
    let t1 = 0, t2_5 = 0, t6_10 = 0, t11_27 = 0
    for (const r of rankings) {
      if (r.measured_date !== latestDate) continue
      if (!r.is_our_product) continue
      const p = r.position
      if (p === 1) t1++
      else if (p >= 2 && p <= 5) t2_5++
      else if (p >= 6 && p <= 10) t6_10++
      else if (p >= 11 && p <= 27) t11_27++
    }
    return { t1, t2_5, t6_10, t11_27, total: t1 + t2_5 + t6_10 + t11_27 }
  }, [rankings, latestDate])

  // 카테고리별 네이버 검색량 (leaf 이름 = 키워드로 사용)
  const [naverVolByLeaf, setNaverVolByLeaf] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!supabase || catalogs.length === 0) return
    let cancelled = false
    async function loadNaver() {
      const leaves = Array.from(new Set(
        catalogs.map(c => c.category_path.split(' > ').slice(-1)[0]).filter(Boolean)
      ))
      if (leaves.length === 0) return
      try {
        // 최근 7일 내 최신값 가져오기
        const since = (() => {
          const d = new Date(); d.setDate(d.getDate() - 7)
          return d.toISOString().slice(0, 10)
        })()
        const { data } = await supabase!
          .from('keyword_search_volumes')
          .select('keyword, total_volume, target_date')
          .in('keyword', leaves)
          .gte('target_date', since)
          .order('target_date', { ascending: false })
        if (cancelled) return
        const m: Record<string, number> = {}
        // 키워드별 가장 최근 값
        for (const r of (data || []) as any[]) {
          if (!m[r.keyword]) m[r.keyword] = Number(r.total_volume || 0)
        }
        setNaverVolByLeaf(m)
      } catch { /* ignore */ }
    }
    loadNaver()
    return () => { cancelled = true }
  }, [catalogs])

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
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 4, fontSize: 10,
              }}>
                {catalogs.map(c => {
                  const st = statsByCatalog.get(c.id)
                  const leaf = c.category_path.split(' > ').slice(-1)[0]
                  const cnt = st?.ourCount || 0
                  const dot = cnt > 0 ? '#059669' : '#CBD5E1'
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 6px', borderRadius: 4,
                      background: cnt > 0 ? '#F0FDF4' : '#F8FAFC',
                      border: '1px solid ' + (cnt > 0 ? '#BBF7D0' : '#E4E7EC'),
                    }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: '50%', background: dot, flexShrink: 0,
                      }} />
                      <a
                        href={c.category_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: 'var(--t2)', textDecoration: 'none', fontWeight: 600,
                          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                        title={c.category_path}
                      >{leaf}</a>
                      <span style={{
                        fontSize: 9, fontWeight: 700,
                        color: cnt > 0 ? '#047857' : '#94A3B8',
                      }}>{cnt}</span>
                      <button
                        onClick={() => openEdit(c)}
                        title="수정"
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: '#CBD5E1', fontSize: 9, padding: 0, lineHeight: 1,
                        }}
                      >✏️</button>
                      <button
                        onClick={() => removeCatalog(c.id)}
                        title="중지"
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: '#CBD5E1', fontSize: 11, padding: 0, lineHeight: 1,
                        }}
                      >×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 순위 등급별 KPI 카드 */}
          {tierStats.total > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              {([
                { label: '🥇 1위',     val: tierStats.t1,    color: '#047857', bg: '#ECFDF5' },
                { label: '🥈 2~5위',   val: tierStats.t2_5,  color: '#0E7490', bg: '#ECFEFF' },
                { label: '🥉 6~10위',  val: tierStats.t6_10, color: '#1E40AF', bg: '#EFF6FF' },
                { label: '📋 11~27위', val: tierStats.t11_27, color: '#92400E', bg: '#FFFBEB' },
              ] as const).map(t => (
                <div key={t.label} style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: t.bg, border: '1px solid ' + t.color + '33',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.color, marginBottom: 4 }}>{t.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: t.color, lineHeight: 1 }}>{t.val}<span style={{ fontSize: 11, marginLeft: 3 }}>개</span></div>
                </div>
              ))}
            </div>
          )}

          {/* 우리 상품 일별 랭킹 추이 — (카테고리 × 상품) 단위 */}
          {trendRows.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>
                🎯 우리 상품 일별 랭킹 추이 ({trendRows.length}개 — 최근 {dateColumns.length}일)
              </div>
              <div style={{ border: '1px solid #E4E7EC', borderRadius: 6, overflow: 'auto', maxHeight: 600 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead style={{ background: '#F9FAFB', position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #E4E7EC', minWidth: 120 }}>카테고리 / 검색량</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #E4E7EC', width: 56 }}>이미지</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #E4E7EC', minWidth: 200 }}>상품명</th>
                      {dateColumns.map(d => {
                        const [, m, day] = d.split('-')
                        return (
                          <th key={d} style={{
                            padding: '8px 6px', textAlign: 'center', borderBottom: '1px solid #E4E7EC',
                            minWidth: 50, fontSize: 10,
                          }}>{`${parseInt(m)}/${parseInt(day)}`}</th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {trendRows.map(row => {
                      const cat = catalogs.find(c => c.id === row.catalogId)
                      const catLeaf = cat?.category_path.split(' > ').slice(-1)[0] || '?'
                      return (
                        <tr key={`${row.catalogId}__${row.productId}`} style={{ borderTop: '1px solid #F3F4F6' }}>
                          <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--t2)' }}>
                            <div style={{ fontWeight: 700 }}>{catLeaf}</div>
                            {naverVolByLeaf[catLeaf] != null && naverVolByLeaf[catLeaf] > 0 && (
                              <div style={{
                                fontSize: 9, color: '#64748B', marginTop: 2,
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                              }} title="네이버 월 검색량">
                                🔍 {naverVolByLeaf[catLeaf].toLocaleString('ko-KR')}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '4px', textAlign: 'center' }}>
                            {row.productImage ? (
                              <img
                                src={row.productImage}
                                alt=""
                                style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, background: '#F8FAFC' }}
                              />
                            ) : (
                              <div style={{ width: 40, height: 40, background: '#F1F5F9', borderRadius: 4, display: 'inline-block' }} />
                            )}
                          </td>
                          <td style={{ padding: '6px 10px', fontSize: 11 }}>
                            <a
                              href={`https://www.coupang.com/vp/products/${row.productId}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#1570EF', textDecoration: 'none' }}
                            >{row.productName || '(상품명 없음)'}</a>
                            <div style={{ fontSize: 9, color: 'var(--t3)' }}>ID {row.productId}</div>
                          </td>
                          {dateColumns.map(d => {
                            const pos = row.positionByDate[d]
                            if (!pos) {
                              return (
                                <td key={d} style={{ padding: '6px 4px', textAlign: 'center', color: '#CBD5E1' }}>
                                  —
                                </td>
                              )
                            }
                            const color = pos <= 5 ? '#059669' : pos <= 15 ? '#0891B2' : pos <= 30 ? '#D97706' : '#94A3B8'
                            const bold  = pos <= 15
                            return (
                              <td key={d} style={{ padding: '6px 4px', textAlign: 'center' }}>
                                <span style={{
                                  fontSize: 13, fontWeight: bold ? 800 : 600, color,
                                }}>{pos}</span>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 6 }}>
                💡 색상: 🟢 1~5위 · 🔵 6~15위 · 🟠 16~30위 · ⚪ 31위 이하 · — 노출 안 됨
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

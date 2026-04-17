'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { NaverKeywordResult } from '@/types'

/* ────────────────────────────────────────────────────────────
   Types (기존 앱 스키마 기반 - keywords + keyword_rankings)
   ──────────────────────────────────────────────────────────── */
type ProductLite = {
  barcode: string
  name: string
  image_url: string | null
}

type Keyword = {
  id: string
  category: string | null
  keyword: string
  type: string
  coupang_product_id: string
  barcode: string | null
  created_at: string
  products: ProductLite | null
}

type Ranking = {
  id: string
  keyword_id: string
  date: string
  rank_position: number
  rating: number | null
  review_count: number | null
}

type SearchVolume = {
  id: string
  keyword: string
  mobile_volume: number
  pc_volume: number
  total_volume: number
  target_date: string
}

type DailySale = {
  date: string
  barcode: string
  quantity: number
}

/* ────────────────────────────────────────────────────────────
   Utils
   ──────────────────────────────────────────────────────────── */
const getKSTDateString = (dateObj: Date = new Date()) => {
  const kstTime = dateObj.getTime() + 9 * 60 * 60 * 1000
  return new Date(kstTime).toISOString().split('T')[0]
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

/** Supabase 페이지네이션 처리 (1000건 초과 시 자동 분할 조회) */
async function fetchAllPages<T = any>(
  buildQuery: (from: number, to: number) => any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  for (let page = 0; page < 20; page++) {
    const from = page * pageSize
    const to = from + pageSize - 1
    const { data, error } = await buildQuery(from, to)
    if (error) {
      console.error('[ranking] fetchAllPages error', error)
      break
    }
    if (!data || data.length === 0) break
    all.push(...(data as T[]))
    if (data.length < pageSize) break
  }
  return all
}

/* ────────────────────────────────────────────────────────────
   Main Component
   ──────────────────────────────────────────────────────────── */
export default function RankingPage() {
  /* 랭킹 페이지 자체 날짜 필터 (기본: 최근 7일) */
  const [filterFrom, setFilterFrom] = useState<string>(() => {
    const d = new Date()
    d.setDate(d.getDate() - 6)
    return getKSTDateString(d)
  })
  const [filterTo, setFilterTo] = useState<string>(() => getKSTDateString(new Date()))

  /* state */
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [rankings, setRankings] = useState<Ranking[]>([])
  const [searchVolumes, setSearchVolumes] = useState<SearchVolume[]>([])
  const [dailySales, setDailySales] = useState<DailySale[]>([])
  const [loading, setLoading] = useState(false)

  /* 키워드 추가 폼 */
  const [newCategory, setNewCategory] = useState('')
  const [newKeyword, setNewKeyword] = useState('')
  const [newCoupangId, setNewCoupangId] = useState('')
  const [newBarcode, setNewBarcode] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productList, setProductList] = useState<ProductLite[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const productBoxRef = useRef<HTMLDivElement>(null)

  /* 네이버 검색량 조회 */
  const [naverKw, setNaverKw] = useState('')
  const [naverLoading, setNaverLoading] = useState(false)
  const [naverResults, setNaverResults] = useState<NaverKeywordResult[]>([])

  /* 정렬 & 편집 */
  const [sortKey, setSortKey] = useState<string>('rankTrend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [editingCat, setEditingCat] = useState<{ id: string; value: string } | null>(null)

  /* 차트 모달 */
  const [chartKw, setChartKw] = useState<Keyword | null>(null)

  /* ─── 초기 로드 & 날짜 변경 시 재조회 ─── */
  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFrom, filterTo])

  async function loadAll() {
    if (!supabase) {
      console.warn('[ranking] supabase client not ready')
      return
    }
    setLoading(true)
    try {
      /* 1. keywords 단독 조회 (products join 없이) */
      const { data: kwData, error: kwErr } = await supabase
        .from('keywords')
        .select('*')
        .order('created_at', { ascending: false })
      if (kwErr) console.error('[ranking] keywords error', kwErr)
      console.log('[ranking] keywords loaded:', (kwData || []).length)

      /* 2. 관련 products 별도 조회 + 클라이언트에서 조합 */
      const barcodes = Array.from(
        new Set((kwData || []).map((k: any) => k.barcode).filter(Boolean)),
      ) as string[]
      const prodMap = new Map<string, ProductLite>()
      if (barcodes.length) {
        const { data: prodData, error: prodErr } = await supabase
          .from('products')
          .select('barcode, name, image_url')
          .in('barcode', barcodes)
        if (prodErr) console.error('[ranking] products error', prodErr)
        ;(prodData || []).forEach((p: any) => prodMap.set(p.barcode, p as ProductLite))
        console.log('[ranking] products loaded:', (prodData || []).length)
      }

      const kws = ((kwData || []) as any[]).map(k => ({
        ...k,
        products: k.barcode ? prodMap.get(k.barcode) || null : null,
      })) as Keyword[]
      setKeywords(kws)

      /* 3. 랭킹: 필터 적용 (pagination 지원) */
      const fromStr = filterFrom
      const toStr = filterTo
      const rkAll = await fetchAllPages<Ranking>((from, to) =>
        supabase!
          .from('keyword_rankings')
          .select('id, keyword_id, date, rank_position, rating, review_count')
          .gte('date', fromStr)
          .lte('date', toStr)
          .order('date', { ascending: true })
          .range(from, to),
      )
      console.log('[ranking] keyword_rankings loaded:', rkAll.length, `(${fromStr} ~ ${toStr})`)
      setRankings(rkAll)

      /* 4. 검색량 (최근 순) */
      const svAll = await fetchAllPages<SearchVolume>((from, to) =>
        supabase!
          .from('keyword_search_volumes')
          .select('*')
          .order('target_date', { ascending: false })
          .range(from, to),
      )
      console.log('[ranking] search_volumes loaded:', svAll.length)
      setSearchVolumes(svAll)

      /* 5. 주간 판매량 비교용 daily_sales (최근 14일, 등록된 바코드만) */
      const twoWeeksAgo = new Date()
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
      if (barcodes.length) {
        const dsAll = await fetchAllPages<DailySale>((from, to) =>
          supabase!
            .from('daily_sales')
            .select('date, barcode, quantity')
            .in('barcode', barcodes)
            .gte('date', getKSTDateString(twoWeeksAgo))
            .range(from, to),
        )
        console.log('[ranking] daily_sales loaded:', dsAll.length)
        setDailySales(dsAll)
      }
    } catch (e) {
      console.error('[ranking] loadAll fatal error', e)
    }
    setLoading(false)
  }

  /* ─── 상품 검색 (debounce) ─── */
  useEffect(() => {
    const t = setTimeout(() => {
      if (productSearch.trim() && showProductDropdown) {
        searchProducts(productSearch.trim())
      } else if (!productSearch.trim()) {
        setProductList([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [productSearch, showProductDropdown])

  async function searchProducts(q: string) {
    if (!supabase) return
    try {
      const { data } = await supabase
        .from('products')
        .select('barcode, name, image_url')
        .ilike('name', `%${q}%`)
        .limit(50)
      if (data) {
        const unique = Array.from(
          new Map(
            (data as ProductLite[])
              .filter(p => p.name)
              .map(item => [item.name, item]),
          ).values(),
        )
        setProductList(unique)
      }
    } catch (e) {
      console.error(e)
    }
  }

  /* 드롭다운 외부 클릭 닫기 */
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (productBoxRef.current && !productBoxRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  /* ─── 키워드 추가 ─── */
  async function handleAddKeyword(e: React.FormEvent) {
    e.preventDefault()
    if (!newKeyword.trim() || !newCoupangId.trim()) {
      alert('키워드와 쿠팡 상품 ID를 입력하세요.')
      return
    }
    if (!supabase) return
    try {
      const { error } = await supabase.from('keywords').insert([
        {
          category: newCategory.trim() || null,
          keyword: newKeyword.trim(),
          type: 'core',
          coupang_product_id: newCoupangId.trim(),
          barcode: newBarcode || null,
        },
      ])
      if (error) throw error
      setNewCategory('')
      setNewKeyword('')
      setNewCoupangId('')
      setNewBarcode('')
      setProductSearch('')
      loadAll()
    } catch (e) {
      console.error(e)
      alert('키워드 추가 중 오류가 발생했습니다.')
    }
  }

  /* ─── 키워드 삭제 ─── */
  async function handleDeleteKeyword(id: string) {
    if (!confirm('정말 삭제하시겠습니까? 관련 랭킹 데이터도 함께 삭제됩니다.')) return
    if (!supabase) return
    try {
      await supabase.from('keyword_rankings').delete().eq('keyword_id', id)
      const { error } = await supabase.from('keywords').delete().eq('id', id)
      if (error) throw error
      loadAll()
    } catch (e) {
      console.error(e)
      alert('키워드 삭제 중 오류가 발생했습니다.')
    }
  }

  /* ─── 카테고리 수정 ─── */
  async function handleUpdateCategory(id: string, value: string) {
    if (!supabase) return
    try {
      const { error } = await supabase
        .from('keywords')
        .update({ category: value.trim() || null })
        .eq('id', id)
      if (error) throw error
      setKeywords(prev =>
        prev.map(k => (k.id === id ? { ...k, category: value.trim() || null } : k)),
      )
      setEditingCat(null)
    } catch (e) {
      console.error(e)
      alert('분류 수정 중 오류가 발생했습니다.')
    }
  }

  /* ─── 네이버 키워드 조회 ─── */
  async function naverLookup() {
    const keywords = naverKw.split(/[,\s]+/).filter(Boolean)
    if (!keywords.length) return
    setNaverLoading(true)
    try {
      const res = await fetch('/api/naver-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      })
      const json = await res.json()
      setNaverResults(json.results || [])
    } catch {
      setNaverResults([])
    }
    setNaverLoading(false)
  }

  /* ─── 파생 데이터 ─── */

  /* 날짜 컬럼: 전체 데이터에서 최근 14일만 표시 */
  const allDates = useMemo(() => {
    const s = new Set(rankings.map(r => r.date))
    return Array.from(s).sort((a, b) => (a < b ? -1 : 1))
  }, [rankings])

  const displayDates = useMemo(() => allDates.slice(-7), [allDates])

  /* 검색량 매핑: 키워드 → 최근순 배열 */
  const svMap = useMemo(() => {
    const byKw = new Map<string, SearchVolume[]>()
    searchVolumes.forEach(sv => {
      const arr = byKw.get(sv.keyword) || []
      arr.push(sv)
      byKw.set(sv.keyword, arr)
    })
    byKw.forEach(arr =>
      arr.sort((a, b) => (a.target_date < b.target_date ? 1 : -1)),
    )
    return byKw
  }, [searchVolumes])

  /* 주간 판매량: 최근 7일 vs 이전 7일 (바코드 기준 합산) */
  const salesByBarcode = useMemo(() => {
    const result = new Map<string, { thisWeek: number; lastWeek: number }>()
    const today = new Date()
    const thisWeekStart = new Date(today)
    thisWeekStart.setDate(today.getDate() - 6)
    const lastWeekEnd = new Date(thisWeekStart)
    lastWeekEnd.setDate(thisWeekStart.getDate() - 1)
    const lastWeekStart = new Date(lastWeekEnd)
    lastWeekStart.setDate(lastWeekEnd.getDate() - 6)

    const tws = getKSTDateString(thisWeekStart)
    const twe = getKSTDateString(today)
    const lws = getKSTDateString(lastWeekStart)
    const lwe = getKSTDateString(lastWeekEnd)

    dailySales.forEach(d => {
      const cur = result.get(d.barcode) || { thisWeek: 0, lastWeek: 0 }
      if (d.date >= tws && d.date <= twe) cur.thisWeek += d.quantity || 0
      else if (d.date >= lws && d.date <= lwe) cur.lastWeek += d.quantity || 0
      result.set(d.barcode, cur)
    })
    return result
  }, [dailySales])

  /* 키워드별 랭킹 맵 */
  const rankingsByKw = useMemo(() => {
    const m = new Map<string, Ranking[]>()
    rankings.forEach(r => {
      const arr = m.get(r.keyword_id) || []
      arr.push(r)
      m.set(r.keyword_id, arr)
    })
    return m
  }, [rankings])

  /* 정렬된 키워드 */
  const sortedKeywords = useMemo(() => {
    /* rankTrend 계산용: displayDates의 처음/마지막 */
    const firstDate = displayDates[0]
    const lastDate = displayDates[displayDates.length - 1]

    const getTrendForKw = (kwId: string) => {
      const kwRanks = rankingsByKw.get(kwId) || []
      const last = kwRanks.find(r => r.date === lastDate)?.rank_position || 0
      const first = kwRanks.find(r => r.date === firstDate)?.rank_position || 0
      /* 순위는 숫자 작을수록 좋음 → 상승폭 = first - last (양수면 순위 상승) */
      if (!last || !first) return 0
      return first - last
    }

    const arr = [...keywords]
    arr.sort((a, b) => {
      let av: any = ''
      let bv: any = ''
      if (sortKey === 'rankTrend') {
        av = getTrendForKw(a.id)
        bv = getTrendForKw(b.id)
      } else if (sortKey === 'category') {
        av = (a.category || '').toLowerCase()
        bv = (b.category || '').toLowerCase()
      } else if (sortKey === 'keyword') {
        av = a.keyword.toLowerCase()
        bv = b.keyword.toLowerCase()
      } else if (sortKey === 'product') {
        av = (a.products?.name || '').toLowerCase()
        bv = (b.products?.name || '').toLowerCase()
      } else if (sortKey === 'volLatest' || sortKey === 'volPrev' || sortKey === 'volTrend') {
        const aSv = svMap.get(a.keyword) || []
        const bSv = svMap.get(b.keyword) || []
        const aLatest = aSv[0]?.total_volume || 0
        const aPrev = aSv[1]?.total_volume || 0
        const bLatest = bSv[0]?.total_volume || 0
        const bPrev = bSv[1]?.total_volume || 0
        if (sortKey === 'volLatest') { av = aLatest; bv = bLatest }
        if (sortKey === 'volPrev') { av = aPrev; bv = bPrev }
        if (sortKey === 'volTrend') { av = aLatest - aPrev; bv = bLatest - bPrev }
      } else if (sortKey === 'salesThis' || sortKey === 'salesLast' || sortKey === 'salesWow') {
        const aS = salesByBarcode.get(a.barcode || '') || { thisWeek: 0, lastWeek: 0 }
        const bS = salesByBarcode.get(b.barcode || '') || { thisWeek: 0, lastWeek: 0 }
        if (sortKey === 'salesThis') { av = aS.thisWeek; bv = bS.thisWeek }
        if (sortKey === 'salesLast') { av = aS.lastWeek; bv = bS.lastWeek }
        if (sortKey === 'salesWow') { av = aS.thisWeek - aS.lastWeek; bv = bS.thisWeek - bS.lastWeek }
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [keywords, sortKey, sortDir, svMap, salesByBarcode, rankingsByKw, displayDates])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortArrow({ k }: { k: string }) {
    if (sortKey !== k) return <span className="sort-arrow">⇅</span>
    return <span className="sort-arrow active">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  /* 연결상품 컬럼 너비: 가장 긴 상품명에 맞춰 동적 계산 */
  const productColWidth = useMemo(() => {
    const longest = keywords.reduce((max, k) => {
      const n = (k.products?.name || '').length
      return n > max ? n : max
    }, 0)
    /* 이미지 30px + gap + 글자당 약 7.5px + padding 여유 */
    const w = 48 + Math.ceil(longest * 7.5) + 16
    /* 너무 좁거나 넓지 않게 제한 */
    return Math.max(140, Math.min(w, 280))
  }, [keywords])

  /* sticky 컬럼 left offset 계산 */
  const stickyLeft = {
    category: 0,
    keyword: 90,
    product: 90 + 140,
  }
  const productRight = stickyLeft.product + productColWidth

  /* ─── KPI 계산: 전일 기준 랭크 구간 집계 ─── */
  const kpiData = useMemo(() => {
    /* 전일(어제) 날짜 계산 */
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yStr = getKSTDateString(yesterday)

    /* 전일자 랭킹: 없으면 allDates 중 가장 최근으로 fallback */
    let targetDate = yStr
    if (!rankings.some(r => r.date === yStr)) {
      targetDate = allDates[allDates.length - 1] || yStr
    }

    const dayRanks = rankings.filter(r => r.date === targetDate && r.rank_position > 0)
    const inRange = (lo: number, hi: number) =>
      dayRanks.filter(r => r.rank_position >= lo && r.rank_position <= hi).length

    return {
      targetDate,
      top10: inRange(1, 10),
      mid: inRange(11, 27),
      low: inRange(28, 54),
    }
  }, [rankings, allDates])

  /* ──────────────────────────────────────────────────────── */
  return (
    <div>
      {/* KPI Row */}
      <div className="krow">
        <div className="kpi kc-bl">
          <div className="kpi-top"><div className="kpi-ico">🔑</div></div>
          <div className="kpi-lbl">등록 키워드</div>
          <div className="kpi-val">{keywords.length}</div>
          <div className="kpi-foot">추적 중</div>
        </div>
        <div className="kpi kc-am">
          <div className="kpi-top"><div className="kpi-ico">🥇</div></div>
          <div className="kpi-lbl">1~10위 랭킹</div>
          <div className="kpi-val">{kpiData.top10}</div>
          <div className="kpi-foot">전일 기준</div>
        </div>
        <div className="kpi kc-gr">
          <div className="kpi-top"><div className="kpi-ico">📍</div></div>
          <div className="kpi-lbl">11~27위 랭킹</div>
          <div className="kpi-val">{kpiData.mid}</div>
          <div className="kpi-foot">전일 기준</div>
        </div>
        <div className="kpi kc-pu">
          <div className="kpi-top"><div className="kpi-ico">📊</div></div>
          <div className="kpi-lbl">28~54위 랭킹</div>
          <div className="kpi-val">{kpiData.low}</div>
          <div className="kpi-foot">전일 기준</div>
        </div>
      </div>

      {/* 키워드 추가 + 네이버 조회 (2열) */}
      <div className="g2">
        {/* 키워드 추가 카드 */}
        <div className="card">
          <div className="ch">
            <div className="ch-l">
              <div className="ch-ico">➕</div>
              <div>
                <div className="ch-title">키워드 추가</div>
                <div className="ch-sub">추적할 키워드 & 연결상품 등록</div>
              </div>
            </div>
          </div>
          <div className="cb">
            <form onSubmit={handleAddKeyword}>
              <div className="fgrid" style={{ marginBottom: 10 }}>
                <div className="fcol">
                  <label className="fl">🗂 분류</label>
                  <input
                    className="fi"
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    placeholder="예: 원피스, 신발"
                  />
                </div>
                <div className="fcol">
                  <label className="fl">🔑 키워드 *</label>
                  <input
                    className="fi"
                    value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    placeholder="필수"
                    required
                  />
                </div>
                <div className="fcol">
                  <label className="fl">🆔 쿠팡 상품 ID *</label>
                  <input
                    className="fi"
                    value={newCoupangId}
                    onChange={e => setNewCoupangId(e.target.value)}
                    placeholder="필수"
                    required
                  />
                </div>
              </div>

              {/* 상품 검색 드롭다운 */}
              <div className="fcol" style={{ position: 'relative', marginBottom: 10 }} ref={productBoxRef}>
                <label className="fl">📦 연결상품 (상품명 검색)</label>
                <input
                  className="fi"
                  value={productSearch}
                  onChange={e => {
                    setProductSearch(e.target.value)
                    setShowProductDropdown(true)
                    if (!e.target.value) setNewBarcode('')
                  }}
                  onFocus={() => setShowProductDropdown(true)}
                  placeholder="상품명 일부 입력 (예: 신비)"
                />
                {newBarcode && (
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                    선택된 바코드: <b>{newBarcode}</b>
                  </div>
                )}
                {showProductDropdown && productList.length > 0 && (
                  <div className="prod-drop">
                    {productList.map(p => (
                      <div
                        key={p.barcode}
                        className="prod-drop-item"
                        onClick={() => {
                          setProductSearch(p.name)
                          setNewBarcode(p.barcode)
                          setShowProductDropdown(false)
                        }}
                      >
                        {p.image_url && (
                          <img src={p.image_url} alt="" className="prod-drop-img" />
                        )}
                        <div className="prod-drop-info">
                          <div className="prod-drop-name">{p.name}</div>
                          <div className="prod-drop-bar">{p.barcode}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button type="submit" className="btn-p" style={{ width: '100%' }}>
                ➕ 추가
              </button>
            </form>
          </div>
        </div>

        {/* 네이버 검색량 카드 */}
        <div className="card">
          <div className="ch">
            <div className="ch-l">
              <div className="ch-ico">🔎</div>
              <div>
                <div className="ch-title">네이버 키워드 검색량</div>
                <div className="ch-sub">네이버 검색광고 API 조회</div>
              </div>
            </div>
          </div>
          <div className="cb">
            <div className="frow">
              <input
                className="si"
                value={naverKw}
                onChange={e => setNaverKw(e.target.value)}
                placeholder="키워드 쉼표로 구분 입력..."
                onKeyDown={e => e.key === 'Enter' && naverLookup()}
              />
              <button className="btn-p" onClick={naverLookup} disabled={naverLoading}>
                {naverLoading ? <><span className="spinner" /> 조회중</> : '🔍 조회'}
              </button>
            </div>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>키워드</th>
                    <th>PC</th>
                    <th>모바일</th>
                    <th>합계</th>
                    <th>경쟁도</th>
                  </tr>
                </thead>
                <tbody>
                  {naverResults.length > 0 ? (
                    naverResults.map((r, i) => (
                      <tr key={i}>
                        <td><span className="kw-tag">{r.keyword}</span></td>
                        <td style={{ fontWeight: 700 }}>{fmt(r.pc)}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(r.mobile)}</td>
                        <td style={{ fontWeight: 800 }}>{fmt(r.total)}</td>
                        <td>
                          <span
                            className={`badge ${
                              r.competition === 'high'
                                ? 'b-re'
                                : r.competition === 'mid'
                                ? 'b-am'
                                : 'b-gr'
                            }`}
                          >
                            {r.competition === 'high'
                              ? '높음'
                              : r.competition === 'mid'
                              ? '중간'
                              : '낮음'}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>
                        <div className="empty-st" style={{ padding: 20 }}>
                          <div className="es-ico">🔎</div>
                          <div className="es-t">키워드를 입력하고 조회하세요</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* 순위 추이 테이블 (가로 스크롤) */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="ch">
          <div className="ch-l">
            <div className="ch-ico">📊</div>
            <div>
              <div className="ch-title">키워드 순위 추이</div>
              <div className="ch-sub">
                {loading ? '로딩 중...' : `${keywords.length}개 키워드 · ${rankings.length}건 · ${displayDates.length}일 표시`}
              </div>
            </div>
          </div>
          <div className="ch-r" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="date"
              className="fi"
              style={{ width: 140, padding: '6px 8px', fontSize: 12 }}
              value={filterFrom}
              max={filterTo}
              onChange={e => setFilterFrom(e.target.value)}
            />
            <span style={{ color: 'var(--t3)', fontSize: 12 }}>~</span>
            <input
              type="date"
              className="fi"
              style={{ width: 140, padding: '6px 8px', fontSize: 12 }}
              value={filterTo}
              min={filterFrom}
              onChange={e => setFilterTo(e.target.value)}
            />
            <button
              className="btn-p"
              style={{ padding: '6px 10px', fontSize: 11 }}
              onClick={() => {
                const d = new Date()
                setFilterTo(getKSTDateString(d))
                d.setDate(d.getDate() - 6)
                setFilterFrom(getKSTDateString(d))
              }}
            >
              최근 7일
            </button>
          </div>
        </div>
        <div className="cb" style={{ padding: 0 }}>
          <div className="rk-scroll-wrap">
            <table className="rk-tbl">
              <thead>
                <tr>
                  <th className="rk-sticky" style={{ left: 0, width: 90, zIndex: 31 }}>
                    <button className="th-sort" onClick={() => toggleSort('category')}>
                      분류 <SortArrow k="category" />
                    </button>
                  </th>
                  <th className="rk-sticky" style={{ left: 90, width: 140, zIndex: 31 }}>
                    <button className="th-sort" onClick={() => toggleSort('keyword')}>
                      키워드 <SortArrow k="keyword" />
                    </button>
                  </th>
                  <th className="rk-sticky" style={{ left: stickyLeft.product, width: productColWidth, zIndex: 31 }}>
                    <button className="th-sort" onClick={() => toggleSort('product')}>
                      연결상품 <SortArrow k="product" />
                    </button>
                  </th>
                  <th style={{ width: 80 }}>
                    <button className="th-sort" onClick={() => toggleSort('volPrev')}>
                      검색량 이전 <SortArrow k="volPrev" />
                    </button>
                  </th>
                  <th style={{ width: 80 }}>
                    <button className="th-sort" onClick={() => toggleSort('volLatest')}>
                      검색량 최신 <SortArrow k="volLatest" />
                    </button>
                  </th>
                  <th style={{ width: 70 }}>
                    <button className="th-sort" onClick={() => toggleSort('volTrend')}>
                      추이 <SortArrow k="volTrend" />
                    </button>
                  </th>
                  <th style={{ width: 80 }}>
                    <button className="th-sort" onClick={() => toggleSort('salesLast')}>
                      전주 판매 <SortArrow k="salesLast" />
                    </button>
                  </th>
                  <th style={{ width: 80 }}>
                    <button className="th-sort" onClick={() => toggleSort('salesThis')}>
                      이번주 판매 <SortArrow k="salesThis" />
                    </button>
                  </th>
                  <th style={{ width: 70 }}>
                    <button className="th-sort" onClick={() => toggleSort('salesWow')}>
                      WoW <SortArrow k="salesWow" />
                    </button>
                  </th>
                  {displayDates.map(d => {
                    const [, m, day] = d.split('-')
                    return (
                      <th key={d} style={{ width: 60 }}>
                        <div style={{ fontSize: 11 }}>{`${parseInt(m)}/${parseInt(day)}`}</div>
                      </th>
                    )
                  })}
                  <th style={{ width: 50 }} />
                </tr>
              </thead>
              <tbody>
                {sortedKeywords.length === 0 ? (
                  <tr>
                    <td colSpan={9 + displayDates.length + 1}>
                      <div className="empty-st" style={{ padding: 40 }}>
                        <div className="es-ico">📊</div>
                        <div className="es-t">
                          {loading ? '데이터를 불러오는 중...' : '등록된 키워드가 없습니다'}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedKeywords.map(kw => {
                    const kwRanks = rankingsByKw.get(kw.id) || []
                    const svArr = svMap.get(kw.keyword) || []
                    const volLatest = svArr[0]?.total_volume || 0
                    const volPrev = svArr[1]?.total_volume || 0
                    const volTrend = volLatest - volPrev
                    const salesInfo = salesByBarcode.get(kw.barcode || '') || {
                      thisWeek: 0,
                      lastWeek: 0,
                    }
                    const wow = salesInfo.thisWeek - salesInfo.lastWeek
                    return (
                      <tr key={kw.id} className="rk-row" onClick={() => setChartKw(kw)}>
                        {/* 분류 */}
                        <td
                          className="rk-sticky"
                          style={{ left: 0, width: 90 }}
                          onClick={e => e.stopPropagation()}
                          onDoubleClick={() =>
                            setEditingCat({ id: kw.id, value: kw.category || '' })
                          }
                        >
                          {editingCat?.id === kw.id ? (
                            <input
                              autoFocus
                              className="fi"
                              style={{ padding: '4px 6px', fontSize: 11 }}
                              value={editingCat.value}
                              onChange={e =>
                                setEditingCat({ id: kw.id, value: e.target.value })
                              }
                              onBlur={() => handleUpdateCategory(kw.id, editingCat.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter')
                                  handleUpdateCategory(kw.id, editingCat.value)
                                if (e.key === 'Escape') setEditingCat(null)
                              }}
                            />
                          ) : (
                            <span className="cat-tag">{kw.category || '-'}</span>
                          )}
                        </td>
                        {/* 키워드 */}
                        <td className="rk-sticky" style={{ left: 90, width: 140 }}>
                          <span className="kw-tag">{kw.keyword}</span>
                        </td>
                        {/* 연결상품 */}
                        <td
                          className="rk-sticky rk-prod"
                          style={{ left: stickyLeft.product, width: productColWidth }}
                        >
                          <div className="rk-prod-cell">
                            {kw.products?.image_url && (
                              <img
                                src={kw.products.image_url}
                                alt=""
                                className="rk-prod-img"
                              />
                            )}
                            <span className="rk-prod-name">{kw.products?.name || '-'}</span>
                          </div>
                        </td>
                        {/* 검색량 이전 */}
                        <td className="rk-center">{volPrev > 0 ? fmt(volPrev) : '-'}</td>
                        {/* 검색량 최신 */}
                        <td className="rk-center" style={{ fontWeight: 700 }}>
                          {volLatest > 0 ? fmt(volLatest) : '-'}
                          {volLatest >= 5000 && <span title="인기 키워드"> 🔥</span>}
                        </td>
                        {/* 검색량 추이 */}
                        <td
                          className="rk-center"
                          style={{
                            color:
                              volTrend > 0
                                ? 'var(--red)'
                                : volTrend < 0
                                ? 'var(--blue, #386ED9)'
                                : 'var(--t3)',
                            fontWeight: 700,
                          }}
                        >
                          {volTrend !== 0
                            ? `${volTrend > 0 ? '+' : ''}${fmt(volTrend)}`
                            : volLatest > 0
                            ? '-'
                            : ''}
                        </td>
                        {/* 전주 판매 */}
                        <td className="rk-center" style={{ color: 'var(--t3)' }}>
                          {salesInfo.lastWeek || '-'}
                        </td>
                        {/* 이번주 판매 */}
                        <td className="rk-center" style={{ fontWeight: 700 }}>
                          {salesInfo.thisWeek || '-'}
                        </td>
                        {/* WoW */}
                        <td
                          className="rk-center"
                          style={{
                            color:
                              wow > 0
                                ? 'var(--red)'
                                : wow < 0
                                ? 'var(--blue, #386ED9)'
                                : 'var(--t3)',
                            fontWeight: 700,
                          }}
                        >
                          {wow !== 0
                            ? `${wow > 0 ? '▲' : '▼'}${Math.abs(wow)}`
                            : salesInfo.thisWeek > 0
                            ? '-'
                            : ''}
                        </td>
                        {/* 날짜별 순위 */}
                        {displayDates.map((date, idx) => {
                          const r = kwRanks.find(x => x.date === date)
                          const pos = r?.rank_position || 0
                          let prev = 0
                          if (idx > 0) {
                            const prevR = kwRanks.find(x => x.date === displayDates[idx - 1])
                            prev = prevR?.rank_position || 0
                          }
                          return (
                            <td key={date} className="rk-center">
                              {pos > 0 ? (
                                <div>
                                  <span
                                    className={`rank-medal ${
                                      pos === 1
                                        ? 'rm1'
                                        : pos <= 3
                                        ? 'rm2'
                                        : pos <= 10
                                        ? 'rm3'
                                        : 'rmn'
                                    }`}
                                  >
                                    {pos}
                                  </span>
                                  {prev > 0 && prev !== pos && (
                                    <span
                                      style={{
                                        marginLeft: 2,
                                        fontSize: 9,
                                        fontWeight: 800,
                                        color:
                                          prev > pos ? 'var(--red)' : 'var(--blue, #386ED9)',
                                      }}
                                    >
                                      {prev > pos ? '▲' : '▼'}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span style={{ opacity: 0.2 }}>-</span>
                              )}
                            </td>
                          )
                        })}
                        {/* 삭제 */}
                        <td className="rk-center">
                          <button
                            className="btn-del"
                            onClick={e => {
                              e.stopPropagation()
                              handleDeleteKeyword(kw.id)
                            }}
                            title="삭제"
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 차트 모달 */}
      {chartKw && (
        <ChartModal
          keyword={chartKw}
          rankings={rankings.filter(r => r.keyword_id === chartKw.id)}
          onClose={() => setChartKw(null)}
        />
      )}

      {/* 로컬 스타일 */}
      <style jsx>{`
        .sort-arrow { font-size: 9px; opacity: 0.4; margin-left: 2px; }
        .sort-arrow.active { opacity: 1; color: var(--blue, #386ED9); }
        .th-sort {
          background: none; border: none; cursor: pointer; font: inherit;
          color: inherit; padding: 0; display: inline-flex; align-items: center;
        }
        .rk-scroll-wrap {
          overflow-x: auto; overflow-y: visible; max-height: 70vh;
        }
        .rk-tbl {
          width: max-content; min-width: 100%; border-collapse: separate;
          border-spacing: 0; font-size: 12px;
        }
        .rk-tbl thead th {
          position: sticky; top: 0; background: #fafafa; z-index: 20;
          padding: 10px 8px; border-bottom: 1px solid #e5e7eb;
          font-weight: 700; color: var(--t2, #374151); text-align: center;
          white-space: nowrap;
        }
        .rk-tbl tbody td {
          padding: 8px; border-bottom: 1px solid #f1f5f9;
          background: #fff; white-space: nowrap;
        }
        .rk-tbl .rk-sticky { position: sticky; z-index: 15; background: #fff; }
        .rk-tbl thead th.rk-sticky { background: #fafafa; }
        .rk-tbl .rk-center { text-align: center; }
        .rk-row { cursor: pointer; transition: background 0.15s; }
        .rk-row:hover td { background: #f8fafc; }
        .rk-row:hover td.rk-sticky { background: #f8fafc; }
        .rk-prod-cell { display: flex; align-items: center; gap: 6px; }
        .rk-prod-img {
          width: 28px; height: 28px; object-fit: cover; border-radius: 4px;
          background: #f1f5f9;
        }
        .rk-prod-name {
          font-size: 11px; font-weight: 600; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .cat-tag {
          display: inline-block; padding: 2px 8px; border-radius: 4px;
          background: #eef2ff; color: #4338ca; font-size: 11px; font-weight: 600;
        }
        .prod-drop {
          position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
          background: #fff; border: 1px solid #e5e7eb; border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08); max-height: 260px;
          overflow-y: auto; margin-top: 4px;
        }
        .prod-drop-item {
          display: flex; align-items: center; gap: 8px; padding: 8px 10px;
          cursor: pointer; border-bottom: 1px solid #f1f5f9;
        }
        .prod-drop-item:hover { background: #f8fafc; }
        .prod-drop-img {
          width: 32px; height: 32px; object-fit: cover; border-radius: 4px;
          background: #f1f5f9;
        }
        .prod-drop-info { flex: 1; min-width: 0; }
        .prod-drop-name {
          font-size: 12px; font-weight: 600; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .prod-drop-bar { font-size: 10px; color: #94a3b8; }
        .btn-del {
          background: none; border: none; cursor: pointer; opacity: 0.4;
          font-size: 13px; padding: 4px;
        }
        .btn-del:hover { opacity: 1; }
      `}</style>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
   Chart Modal
   ──────────────────────────────────────────────────────────── */
function ChartModal({
  keyword,
  rankings,
  onClose,
}: {
  keyword: Keyword
  rankings: Ranking[]
  onClose: () => void
}) {
  /* 최근 30일 데이터 */
  const allDates = useMemo(() => {
    const s = new Set(rankings.map(r => r.date))
    return Array.from(s).sort((a, b) => (a < b ? -1 : 1)).slice(-30)
  }, [rankings])

  const data = allDates.map(date => {
    const r = rankings.find(x => x.date === date)
    const [, m, d] = date.split('-')
    return {
      label: `${parseInt(m)}/${parseInt(d)}`,
      rank: r?.rank_position || null,
    }
  })

  const validPoints = data.filter(d => d.rank !== null) as { label: string; rank: number }[]
  const hasData = validPoints.length > 0

  const W = 720
  const H = 320
  const PAD_L = 40
  const PAD_R = 20
  const PAD_T = 20
  const PAD_B = 30
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const maxRank = hasData ? Math.max(...validPoints.map(p => p.rank)) : 100
  const minRank = hasData ? Math.min(...validPoints.map(p => p.rank)) : 1
  const yMax = Math.ceil(maxRank * 1.1)
  const yMin = Math.max(1, Math.floor(minRank * 0.9))

  const xFor = (i: number) =>
    PAD_L + (data.length > 1 ? (i * plotW) / (data.length - 1) : plotW / 2)
  const yFor = (r: number) => PAD_T + ((r - yMin) / (yMax - yMin)) * plotH

  const pathD = data
    .map((p, i) => {
      if (p.rank === null) return null
      return `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.rank)}`
    })
    .filter(Boolean)
    .join(' ')

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">📈 {keyword.keyword} · 순위 추이</div>
            <div className="modal-sub">
              연결상품: {keyword.products?.name || '-'}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {hasData ? (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
              {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
                <line
                  key={i}
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={PAD_T + t * plotH}
                  y2={PAD_T + t * plotH}
                  stroke="#f1f5f9"
                  strokeDasharray="3 3"
                />
              ))}
              {[yMin, Math.round((yMin + yMax) / 2), yMax].map((v, i) => (
                <text
                  key={i}
                  x={PAD_L - 6}
                  y={yFor(v) + 4}
                  fontSize="10"
                  fill="#94a3b8"
                  textAnchor="end"
                  fontWeight="700"
                >
                  {v}
                </text>
              ))}
              {data.map((p, i) => {
                if (data.length > 10 && i % Math.ceil(data.length / 10) !== 0 && i !== data.length - 1) return null
                return (
                  <text
                    key={i}
                    x={xFor(i)}
                    y={H - 10}
                    fontSize="10"
                    fill="#94a3b8"
                    textAnchor="middle"
                    fontWeight="700"
                  >
                    {p.label}
                  </text>
                )
              })}
              <path
                d={pathD}
                fill="none"
                stroke="#386ED9"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((p, i) =>
                p.rank !== null ? (
                  <circle
                    key={i}
                    cx={xFor(i)}
                    cy={yFor(p.rank)}
                    r="4"
                    fill="#fff"
                    stroke="#386ED9"
                    strokeWidth="2"
                  />
                ) : null,
              )}
            </svg>
          ) : (
            <div className="empty-st" style={{ padding: 60 }}>
              <div className="es-ico">📊</div>
              <div className="es-t">표시할 순위 데이터가 없습니다</div>
            </div>
          )}
        </div>
      </div>
      <style jsx>{`
        .modal-bg {
          position: fixed; inset: 0; background: rgba(15,23,42,0.6);
          backdrop-filter: blur(6px); z-index: 100;
          display: flex; justify-content: center; align-items: center; padding: 20px;
        }
        .modal-box {
          background: #fff; border-radius: 16px; width: 100%; max-width: 820px;
          overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        }
        .modal-head {
          padding: 18px 24px; border-bottom: 1px solid #f1f5f9;
          display: flex; justify-content: space-between; align-items: center;
          background: #f8fafc;
        }
        .modal-title { font-size: 16px; font-weight: 800; color: #0f172a; }
        .modal-sub { font-size: 11px; color: #94a3b8; font-weight: 700; margin-top: 4px; }
        .modal-close {
          width: 32px; height: 32px; border-radius: 50%; border: none;
          background: transparent; cursor: pointer; font-size: 16px;
          color: #475569;
        }
        .modal-close:hover { background: #e2e8f0; }
        .modal-body { padding: 24px; }
      `}</style>
    </div>
  )
}

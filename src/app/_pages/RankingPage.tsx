'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import RankingBotTrigger from '@/components/RankingBotTrigger'
import KeywordVolumeChart from '@/components/KeywordVolumeChart'
import KeywordSuggestPanel from '@/components/KeywordSuggestPanel'
import DailyKeywordSuggestions from '@/components/DailyKeywordSuggestions'

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
  strategy_tag?: string | null
  memo?: string | null
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
  // barcode → 상품명 매핑 (같은 상품의 모든 옵션 합산용)
  const [barcodeToName, setBarcodeToName] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)

  /* 정렬 & 편집 */
  const [sortKey, setSortKey] = useState<string>('volLatest')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [editingCat, setEditingCat] = useState<{ id: string; value: string } | null>(null)
  const [editingStrategy, setEditingStrategy] = useState<{ id: string; tag: string; memo: string } | null>(null)

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

      /* 5. 주간 판매량 비교용 daily_sales — 같은 상품의 모든 옵션 barcode 합산.
         keywords.barcode는 단일 옵션이라 그것만 합산하면 실제 매출의 1/N 만 보임.
         같은 상품명을 가진 모든 products의 barcode를 찾아서 daily_sales 합산. */
      const initialProductNames = Array.from(new Set(
        [...prodMap.values()].map(p => p.name).filter(Boolean)
      )) as string[]
      const allBarcodeMap = new Map<string, string>() // barcode -> product name
      if (initialProductNames.length) {
        // 같은 상품명을 가진 모든 옵션 barcode (sibling barcodes) 수집
        // 상품명이 많으면 chunk 분할
        const chunks: string[][] = []
        for (let i = 0; i < initialProductNames.length; i += 50) {
          chunks.push(initialProductNames.slice(i, i + 50))
        }
        for (const chunk of chunks) {
          const { data } = await supabase
            .from('products')
            .select('barcode, name')
            .in('name', chunk)
            .limit(10000)
          for (const p of (data || []) as any[]) {
            if (p.barcode && p.name) allBarcodeMap.set(p.barcode, p.name)
          }
        }
      }
      console.log('[ranking] sibling barcodes resolved:', allBarcodeMap.size, 'from', initialProductNames.length, 'products')
      setBarcodeToName(allBarcodeMap)

      const allBarcodes = Array.from(allBarcodeMap.keys())
      const twoWeeksAgo = new Date()
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
      if (allBarcodes.length) {
        // PostgREST URL 길이 한계 회피 — barcode 목록을 chunk로 나눠 병합
        const BC_CHUNK = 200
        const sinceStr = getKSTDateString(twoWeeksAgo)
        const dsAll: DailySale[] = []
        for (let i = 0; i < allBarcodes.length; i += BC_CHUNK) {
          const chunk = allBarcodes.slice(i, i + BC_CHUNK)
          const part = await fetchAllPages<DailySale>((from, to) =>
            supabase!
              .from('daily_sales')
              .select('date, barcode, quantity')
              .in('barcode', chunk)
              .gte('date', sinceStr)
              .range(from, to),
          )
          dsAll.push(...part)
        }
        console.log('[ranking] daily_sales loaded:', dsAll.length, '(across', allBarcodes.length, 'barcodes)')
        setDailySales(dsAll)
      }
    } catch (e) {
      console.error('[ranking] loadAll fatal error', e)
    }
    setLoading(false)
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

  /* 주간 판매량: 최근 7일 vs 이전 7일 — 상품명 기준 (모든 옵션 합산) */
  const salesByProductName = useMemo(() => {
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
      const name = barcodeToName.get(d.barcode)
      if (!name) return
      const cur = result.get(name) || { thisWeek: 0, lastWeek: 0 }
      if (d.date >= tws && d.date <= twe) cur.thisWeek += d.quantity || 0
      else if (d.date >= lws && d.date <= lwe) cur.lastWeek += d.quantity || 0
      result.set(name, cur)
    })
    return result
  }, [dailySales, barcodeToName])

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
        const aS = salesByProductName.get(a.products?.name || '') || { thisWeek: 0, lastWeek: 0 }
        const bS = salesByProductName.get(b.products?.name || '') || { thisWeek: 0, lastWeek: 0 }
        if (sortKey === 'salesThis') { av = aS.thisWeek; bv = bS.thisWeek }
        if (sortKey === 'salesLast') { av = aS.lastWeek; bv = bS.lastWeek }
        if (sortKey === 'salesWow') { av = aS.thisWeek - aS.lastWeek; bv = bS.thisWeek - bS.lastWeek }
      } else if (sortKey.startsWith('date:')) {
        // 특정 측정일의 rank_position 으로 정렬 (작을수록 좋음 → asc = 1위부터)
        const targetDate = sortKey.slice(5)
        const aRanks = rankingsByKw.get(a.id) || []
        const bRanks = rankingsByKw.get(b.id) || []
        const aRank = aRanks.find(r => r.date === targetDate)?.rank_position
        const bRank = bRanks.find(r => r.date === targetDate)?.rank_position
        // 없는 값은 끝으로 (asc 시 큰 값, desc 시 작은 값 취급)
        av = aRank ?? 999999
        bv = bRank ?? 999999
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [keywords, sortKey, sortDir, svMap, salesByProductName, rankingsByKw, displayDates])

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
    product: 90 + 170,  // 키워드 컬럼 width: 170 (태그/메모 노출)
  }
  const productRight = stickyLeft.product + productColWidth

  /* ─── KPI 계산: 가장 최근 "유효 측정일" 기준 (못찾음 100%인 날은 skip) ─── */
  const kpiData = useMemo(() => {
    // 1) allDates는 오름차순. 뒤에서부터 봐서 rank_position > 0 인 row가 있는 첫 날짜 사용
    let targetDate = ''
    for (let i = allDates.length - 1; i >= 0; i--) {
      const d = allDates[i]
      const hasValid = rankings.some(r => r.date === d && r.rank_position > 0)
      if (hasValid) { targetDate = d; break }
    }
    if (!targetDate) targetDate = allDates[allDates.length - 1] || ''

    // 2) 같은 키워드에 여러 row가 있으면 가장 최근 updated 1개만 (방어적 dedup)
    const seen = new Map<string, typeof rankings[number]>()
    for (const r of rankings) {
      if (r.date !== targetDate) continue
      if (!seen.has(r.keyword_id)) seen.set(r.keyword_id, r)
    }
    const dayRanks = Array.from(seen.values()).filter(r => r.rank_position > 0)
    const inRange = (lo: number, hi: number) =>
      dayRanks.filter(r => r.rank_position >= lo && r.rank_position <= hi).length

    return {
      targetDate,
      top10: inRange(1, 10),
      mid: inRange(11, 27),
      low: inRange(28, 54),
      notFound: seen.size > 0 ? seen.size - dayRanks.length : 0,
    }
  }, [rankings, allDates])

  /* ──────────────────────────────────────────────────────── */
  return (
    <div>
      {/* 봇 트리거 패널 (회사 PC의 runner.js와 연동) */}
      <RankingBotTrigger />

      {/* 매일 아침 자동 추천 (Vercel Cron 결과) */}
      <DailyKeywordSuggestions
        existingKeywords={keywords.map(k => k.keyword)}
        onRegisterClick={() => { /* 향후 모달 열기 연결 */ }}
        onRegistered={loadAll}
      />

      {/* 키워드 발굴 제안 (Claude + Naver) */}
      <KeywordSuggestPanel
        existingKeywords={keywords.map(k => k.keyword)}
        categories={Array.from(new Set(keywords.map(k => k.category || '').filter(Boolean)))}
        productNames={Array.from(new Set(keywords.map(k => k.products?.name || '').filter(Boolean)))}
        onRegistered={loadAll}
      />


      {/* 네이버 키워드 검색량 추이 + 상승 키워드 분석 */}
      <KeywordVolumeChart />

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
                  <th className="rk-sticky" style={{ left: 90, width: 170, zIndex: 31 }}>
                    <button className="th-sort" onClick={() => toggleSort('keyword')}>
                      키워드 / 전략 / 메모 <SortArrow k="keyword" />
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
                      <th key={d} style={{ width: 70 }} title="클릭 → 해당 날짜 순위로 정렬">
                        <button className="th-sort" onClick={() => toggleSort(`date:${d}`)} style={{ fontSize: 11 }}>
                          {`${parseInt(m)}/${parseInt(day)}`} <SortArrow k={`date:${d}`} />
                        </button>
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
                    const salesInfo = salesByProductName.get(kw.products?.name || '') || {
                      thisWeek: 0,
                      lastWeek: 0,
                    }
                    const wow = salesInfo.thisWeek - salesInfo.lastWeek
                    return (
                      <tr key={kw.id} className="rk-row">
                        {/* 분류 */}
                        <td
                          className="rk-sticky"
                          style={{ left: 0, width: 90 }}
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
                        {/* 키워드 + 전략 태그 + 메모 (항상 노출 + ✏️ 편집) */}
                        <td
                          className="rk-sticky"
                          style={{ left: 90, width: 170, padding: '6px 8px' }}
                        >
                          {(() => {
                            const isNew = kw.created_at &&
                              (Date.now() - new Date(kw.created_at).getTime()) < 7 * 86400000
                            const tagColors: Record<string, { bg: string; fg: string }> = {
                              '신상':       { bg: '#DBEAFE', fg: '#1E40AF' },
                              '베스트':     { bg: '#FEF3C7', fg: '#92400E' },
                              '광고확장':   { bg: '#FCE7F3', fg: '#9F1239' },
                              '방어':       { bg: '#E0E7FF', fg: '#3730A3' },
                              '행사제안':   { bg: '#FFEDD5', fg: '#9A3412' },
                              '리뷰점검':   { bg: '#FEF9C3', fg: '#854D0E' },
                              '테스트중':   { bg: '#F3E8FF', fg: '#6B21A8' },
                            }
                            const c = kw.strategy_tag ? tagColors[kw.strategy_tag] : null
                            const openEdit = () => setEditingStrategy({
                              id: kw.id, tag: kw.strategy_tag || '', memo: kw.memo || ''
                            })
                            return (
                              <>
                                {/* 1행: 키워드 + 편집 아이콘 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  {isNew && (
                                    <span style={{
                                      fontSize: 9, fontWeight: 700, color: '#C2410C',
                                      background: '#FFEDD5', padding: '1px 4px', borderRadius: 3,
                                    }} title="최근 7일 이내 신규 등록">🆕</span>
                                  )}
                                  <span className="kw-tag" style={{ flex: 1 }}>{kw.keyword}</span>
                                  <button
                                    onClick={openEdit}
                                    title="전략/메모 편집"
                                    style={{
                                      padding: '2px 4px', fontSize: 11, lineHeight: 1,
                                      background: 'transparent', border: 'none', cursor: 'pointer',
                                      opacity: 0.4, color: 'var(--t3)',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                    onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}
                                  >✏️</button>
                                </div>

                                {/* 2행: 전략 태그 (있으면 chip, 없으면 + 태그 placeholder) */}
                                <div style={{ marginTop: 3 }}>
                                  {c && kw.strategy_tag ? (
                                    <span
                                      onClick={openEdit}
                                      style={{
                                        fontSize: 9, fontWeight: 700, color: c.fg, background: c.bg,
                                        padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                                      }}
                                      title="클릭 → 전략 편집"
                                    >{kw.strategy_tag}</span>
                                  ) : (
                                    <span
                                      onClick={openEdit}
                                      style={{
                                        fontSize: 9, color: '#94A3B8', cursor: 'pointer',
                                        border: '1px dashed #CBD5E1', borderRadius: 3,
                                        padding: '1px 6px',
                                      }}
                                      title="클릭 → 전략 태그 추가"
                                    >+ 태그</span>
                                  )}
                                </div>

                                {/* 3행: 메모 (있으면 표시, 없으면 + 메모 placeholder) */}
                                <div style={{ marginTop: 3 }}>
                                  {kw.memo ? (
                                    <span
                                      onClick={openEdit}
                                      style={{
                                        fontSize: 9, color: '#475569',
                                        cursor: 'pointer', lineHeight: 1.3,
                                        background: '#FFFBEB', padding: '2px 6px', borderRadius: 3,
                                        borderLeft: '2px solid #FCD34D',
                                        overflow: 'hidden', textOverflow: 'ellipsis',
                                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                      }}
                                      title={kw.memo}
                                    >📝 {kw.memo}</span>
                                  ) : (
                                    <span
                                      onClick={openEdit}
                                      style={{
                                        fontSize: 9, color: '#94A3B8', cursor: 'pointer',
                                        fontStyle: 'italic',
                                      }}
                                      title="클릭 → 메모 추가"
                                    >+ 메모</span>
                                  )}
                                </div>
                              </>
                            )
                          })()}
                        </td>
                        {/* 연결상품 — 클릭 시 차트 열림 */}
                        <td
                          className="rk-sticky rk-prod rk-prod-clickable"
                          style={{ left: stickyLeft.product, width: productColWidth }}
                          onClick={() => setChartKw(kw)}
                          title="클릭하면 순위 추이 차트가 열립니다"
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
                            <span className="rk-prod-chart-ico">📈</span>
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
                        {/* 날짜별 순위 + 별점/리뷰 (한 셀에 묶음) */}
                        {displayDates.map((date, idx) => {
                          const r = kwRanks.find(x => x.date === date)
                          const pos = r?.rank_position || 0
                          const rating = r?.rating || 0
                          const reviews = r?.review_count || 0
                          let prev = 0
                          if (idx > 0) {
                            const prevR = kwRanks.find(x => x.date === displayDates[idx - 1])
                            prev = prevR?.rank_position || 0
                          }
                          return (
                            <td key={date} className="rk-center" style={{ padding: '4px 2px' }}>
                              {pos > 0 ? (
                                (() => {
                                  // 순위 등급 스타일: 위로 갈수록 강조, 아래로 갈수록 흐림
                                  const tier =
                                    pos === 1     ? { color: '#dc2626', weight: 900, size: 16, opacity: 1 }      // 🏆 1위
                                    : pos <= 3    ? { color: '#ea580c', weight: 800, size: 15, opacity: 1 }      // 🥈 2-3위
                                    : pos <= 10   ? { color: '#2563eb', weight: 800, size: 14, opacity: 1 }      // 🥉 4-10위
                                    : pos <= 20   ? { color: '#1e40af', weight: 700, size: 13, opacity: 0.95 }   // 11-20위
                                    : pos <= 40   ? { color: '#475569', weight: 600, size: 12, opacity: 0.85 }   // 21-40위 (1페이지)
                                    : pos <= 80   ? { color: '#94a3b8', weight: 500, size: 11, opacity: 0.6 }    // 41-80위
                                    :               { color: '#cbd5e1', weight: 400, size: 10, opacity: 0.4 }    // 81+ / 999
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, opacity: tier.opacity }}>
                                      <div>
                                        <span style={{ fontSize: tier.size, fontWeight: tier.weight, color: tier.color }}>
                                          {pos}
                                        </span>
                                        {prev > 0 && prev !== pos && (
                                          <span
                                            style={{
                                              marginLeft: 2,
                                              fontSize: 9,
                                              fontWeight: 800,
                                              color: prev > pos ? 'var(--red)' : 'var(--blue, #386ED9)',
                                            }}
                                          >
                                            {prev > pos ? '▲' : '▼'}
                                          </span>
                                        )}
                                      </div>
                                      {(rating > 0 || reviews > 0) && (
                                        <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.1, display: 'flex', gap: 3 }}>
                                          {rating > 0 && <span style={{ color: '#f59e0b', fontWeight: 700 }}>★{rating}</span>}
                                          {reviews > 0 && <span>({reviews.toLocaleString()})</span>}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })()
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
          overflow-x: scroll;
          overflow-y: auto;
          /* 20행 이상 한 번에 보이게 — 행 ~45px × 20 + 헤더 ≈ 960px, 작은 화면은 90vh로 cap */
          max-height: min(1000px, 90vh);
        }
        /* 크롬/사파리: 가로 스크롤바 항상 보이게 */
        .rk-scroll-wrap::-webkit-scrollbar {
          height: 12px;
          width: 10px;
        }
        .rk-scroll-wrap::-webkit-scrollbar-track {
          background: #f1f5f9;
          border-radius: 6px;
        }
        .rk-scroll-wrap::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 6px;
        }
        .rk-scroll-wrap::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
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
        .rk-row { transition: background 0.15s; }
        .rk-row:hover td { background: #f8fafc; }
        .rk-row:hover td.rk-sticky { background: #f8fafc; }
        .rk-prod-clickable { cursor: pointer; }
        .rk-prod-clickable:hover { background: #eff6ff !important; }
        .rk-prod-clickable:hover .rk-prod-chart-ico { opacity: 1; }
        .rk-prod-chart-ico {
          margin-left: auto; font-size: 12px; opacity: 0.3;
          transition: opacity 0.15s; flex-shrink: 0;
        }
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

      {/* 전략 태그 + 메모 편집 모달 */}
      {editingStrategy && (
        <div
          onClick={() => setEditingStrategy(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 10, padding: 24,
              width: '92%', maxWidth: 480, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>📝 키워드 전략 편집</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4, fontWeight: 600 }}>전략 태그</div>
            <select
              value={editingStrategy.tag}
              onChange={e => setEditingStrategy({ ...editingStrategy, tag: e.target.value })}
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, marginBottom: 12,
                       border: '1px solid #E4E7EC', borderRadius: 6 }}
            >
              <option value="">— 태그 없음 —</option>
              <option value="신상">🆕 신상</option>
              <option value="베스트">🏆 베스트</option>
              <option value="광고확장">📢 광고확장</option>
              <option value="방어">🛡️ 방어</option>
              <option value="행사제안">🎁 행사제안</option>
              <option value="리뷰점검">⭐ 리뷰점검</option>
              <option value="테스트중">🧪 테스트중</option>
            </select>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4, fontWeight: 600 }}>메모 (자유 텍스트)</div>
            <textarea
              value={editingStrategy.memo}
              onChange={e => setEditingStrategy({ ...editingStrategy, memo: e.target.value })}
              placeholder="운영 노트 — 광고 예산, 목표 순위, 경쟁사 동향 등"
              rows={4}
              style={{ width: '100%', padding: 8, fontSize: 13, fontFamily: 'inherit',
                       border: '1px solid #E4E7EC', borderRadius: 6, marginBottom: 16, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditingStrategy(null)}
                style={{ padding: '8px 16px', borderRadius: 6, background: '#fff',
                         color: 'var(--t2)', border: '1px solid #E4E7EC', fontWeight: 600,
                         fontSize: 13, cursor: 'pointer' }}
              >취소</button>
              <button
                onClick={async () => {
                  if (!supabase || !editingStrategy) return
                  const { error } = await supabase.from('keywords').update({
                    strategy_tag: editingStrategy.tag || null,
                    memo: editingStrategy.memo.trim() || null,
                  }).eq('id', editingStrategy.id)
                  if (error) { alert('저장 실패: ' + error.message); return }
                  setEditingStrategy(null)
                  loadAll()
                }}
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

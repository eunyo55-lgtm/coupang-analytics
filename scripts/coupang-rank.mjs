// 쿠팡 랭킹 봇
// 매일 1회 — keywords 테이블의 각 (keyword, coupang_product_id) 쌍에 대해
// 쿠팡 검색 결과 페이지를 fetch하고 해당 product_id의 노출 순위를 찾아
// keyword_rankings 테이블에 저장

import { selectAll, insertRows, deleteWhere } from './lib/supabase.mjs'

const COUPANG_SEARCH = 'https://www.coupang.com/np/search'
const PAGE_SIZE = 72   // 쿠팡 페이지당 노출 수
const MAX_PAGES = 5    // 최대 5페이지(360개)까지 추적
const REQUEST_DELAY_MS = 2000   // 페이지 사이 2초 대기 (anti-block)
const DEBUG = process.env.COUPANG_DEBUG === '1'

// 더 사실적인 데스크톱 Chrome User-Agent + 가능한 모든 일반적 헤더
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function getKSTDate() {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

async function fetchSearchPage(keyword, page) {
  const url = `${COUPANG_SEARCH}?q=${encodeURIComponent(keyword)}&listSize=${PAGE_SIZE}&page=${page}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.coupang.com/',
    },
  })
  if (!res.ok) {
    console.warn(`[coupang] "${keyword}" page ${page}: HTTP ${res.status}`)
    return null
  }
  return res.text()
}

// 검색 결과 HTML에서 product_id 리스트를 노출 순서대로 추출
// 쿠팡 HTML 구조가 자주 바뀌므로 여러 패턴을 시도
function parseSearchResults(html, keyword = '') {
  // Strategy A: <li class="search-product" data-product-id="123">  (전통)
  const A = /<li[^>]*class="[^"]*search-product[^"]*"[^>]*data-product-id="(\d+)"/g
  // Strategy B: data-product-id="123"  (어떤 태그든)
  const B = /data-product-id="(\d+)"/g
  // Strategy C: /vp/products/{id} URL — 검색 결과 모든 카드의 링크
  const C = /\/vp\/products\/(\d+)/g
  // Strategy D: data-id, data-vendor-item-id 등 변형
  const D = /data-vendor-item-id="(\d+)"/g

  function collect(re) {
    const seen = new Set()
    const out = []
    let m
    while ((m = re.exec(html)) !== null) {
      const id = m[1]
      if (!seen.has(id)) {
        seen.add(id)
        out.push({ productId: id })
      }
    }
    return out
  }

  let items = collect(A)
  let usedStrategy = 'A(search-product li)'
  if (items.length === 0) { items = collect(B); usedStrategy = 'B(data-product-id any)' }
  if (items.length === 0) { items = collect(C); usedStrategy = 'C(/vp/products URL)' }
  if (items.length === 0) { items = collect(D); usedStrategy = 'D(vendor-item-id)' }

  if (items.length > 0 && DEBUG) {
    console.log(`[coupang] "${keyword}" parsed ${items.length} items via ${usedStrategy}`)
  }
  if (items.length === 0) {
    // 디버깅: HTML 첫 800자 + 봇 차단 단서 검사
    const isBlock = /captcha|robot|차단|access\s+denied/i.test(html)
    const isEmpty = /검색결과가\s*없|no\s+results/i.test(html)
    console.warn(`[coupang] ⚠️ "${keyword}" parsed 0 items.`,
      `isBlockPage=${isBlock}`, `isEmptySearch=${isEmpty}`,
      `html.length=${html.length}`)
    if (DEBUG) console.warn('[coupang] HTML preview:\n', html.slice(0, 1500))
  }
  return items
}

async function findRankForKeyword(keyword, productId) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchSearchPage(keyword, page)
    if (!html) break
    const items = parseSearchResults(html, `${keyword}-p${page}`)
    if (!items.length) {
      // 0 items면 더 진행해도 의미 없음 — 즉시 종료
      break
    }
    const idx = items.findIndex(it => it.productId === productId)
    if (idx >= 0) {
      const rank = (page - 1) * PAGE_SIZE + idx + 1
      // rating, review_count는 다른 패스에서 추출 시도해도 되지만 쿠팡 HTML 변화로
      // 신뢰도 낮으므로 일단 null. 필요해지면 별도 RPC나 product 디테일 페이지로 확장.
      return { rank, rating: null, reviewCount: null }
    }
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS))
  }
  return null   // 5 페이지 안에 못 찾음 = 권외
}

async function main() {
  console.log(`[coupang] start ${new Date().toISOString()}`)

  const keywords = await selectAll(
    'keywords',
    'select=id,keyword,coupang_product_id&keyword=not.is.null&coupang_product_id=not.is.null'
  )
  console.log(`[coupang] keywords to track: ${keywords.length}`)
  if (!keywords.length) return

  const today = getKSTDate()

  // 오늘자 이미 들어간 row 삭제 (재실행 시 중복 방지)
  await deleteWhere('keyword_rankings', `date=eq.${today}`)
  console.log(`[coupang] cleared existing rows for ${today}`)

  const rows = []
  let success = 0, missing = 0, errors = 0

  for (const k of keywords) {
    try {
      const result = await findRankForKeyword(k.keyword, String(k.coupang_product_id))
      if (result) {
        rows.push({
          keyword_id: k.id,
          date: today,
          rank_position: result.rank,
          rating: result.rating,
          review_count: result.reviewCount,
        })
        success++
        console.log(`[coupang] ✓ "${k.keyword}" → rank ${result.rank}`)
      } else {
        // 권외 — rank_position을 999로 기록 (또는 null로 두고 싶으면 여기 변경)
        rows.push({
          keyword_id: k.id,
          date: today,
          rank_position: 999,
          rating: null,
          review_count: null,
        })
        missing++
        console.log(`[coupang] - "${k.keyword}" → 권외 (5페이지까지 미발견)`)
      }
    } catch (e) {
      errors++
      console.error(`[coupang] "${k.keyword}" error:`, e.message)
    }
    // 키워드 간 간격
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS))
  }

  if (rows.length) {
    await insertRows('keyword_rankings', rows)
    console.log(`[coupang] inserted ${rows.length} rows`)
  }

  console.log(`[coupang] done ${new Date().toISOString()} — success:${success} missing:${missing} errors:${errors}`)
}

main().catch(e => {
  console.error('[coupang] fatal:', e)
  process.exit(1)
})

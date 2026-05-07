// 쿠팡 랭킹 봇
// 매일 1회 — keywords 테이블의 각 (keyword, coupang_product_id) 쌍에 대해
// 쿠팡 검색 결과 페이지를 fetch하고 해당 product_id의 노출 순위를 찾아
// keyword_rankings 테이블에 저장

import { selectAll, insertRows, deleteWhere } from './lib/supabase.mjs'

const COUPANG_SEARCH = 'https://www.coupang.com/np/search'
const PAGE_SIZE = 72   // 쿠팡 페이지당 노출 수
const MAX_PAGES = 5    // 최대 5페이지(360개)까지 추적
const REQUEST_DELAY_MS = 1500   // 페이지 사이 1.5초 대기 (anti-block)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

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
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      Referer: 'https://www.coupang.com/',
    },
  })
  if (!res.ok) {
    console.warn(`[coupang] "${keyword}" page ${page}: HTTP ${res.status}`)
    return null
  }
  return res.text()
}

// 검색 결과 HTML에서 (data-product-id, rating, review_count) 순서대로 추출
function parseSearchResults(html) {
  const items = []
  // <li class="search-product" data-product-id="123" ...>
  // 광고/쿠팡 추천 등은 data-is-ad-rocket 또는 클래스로 구분 가능 — 일단 모두 포함
  const liRegex = /<li[^>]*class="search-product[^"]*"[^>]*data-product-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/g
  let m
  while ((m = liRegex.exec(html)) !== null) {
    const productId = m[1]
    const inner = m[2]

    // 평점 (rating) — class="rating" 안의 숫자
    const ratingMatch = inner.match(/class="rating"[^>]*>([\d.]+)/)
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null

    // 리뷰 수 — class="rating-total-count">(123)</em>
    const reviewMatch = inner.match(/class="rating-total-count"[^>]*>\s*\(?([\d,]+)\)?/)
    const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ''), 10) : null

    items.push({ productId, rating, reviewCount })
  }
  return items
}

async function findRankForKeyword(keyword, productId) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchSearchPage(keyword, page)
    if (!html) break
    const items = parseSearchResults(html)
    if (!items.length) {
      console.warn(`[coupang] "${keyword}" page ${page}: 0 items parsed`)
      break
    }
    const idx = items.findIndex(it => it.productId === productId)
    if (idx >= 0) {
      const rank = (page - 1) * PAGE_SIZE + idx + 1
      const hit = items[idx]
      return { rank, rating: hit.rating, reviewCount: hit.reviewCount }
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

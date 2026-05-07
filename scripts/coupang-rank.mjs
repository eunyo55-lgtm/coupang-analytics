// 쿠팡 랭킹 봇 (Playwright 버전)
// fetch 기반은 GitHub Actions datacenter IP가 쿠팡에 차단되어 0건 파싱 → 모두 권외 처리됨.
// Playwright로 실제 Chromium을 띄워 사람이 보는 것과 동일한 페이지를 받아 파싱한다.

import { chromium } from 'playwright'
import { selectAll, insertRows, deleteWhere } from './lib/supabase.mjs'

const COUPANG_SEARCH = 'https://www.coupang.com/np/search'
const PAGE_SIZE = 72
const MAX_PAGES = 5
const REQUEST_DELAY_MS = 2500
const NAV_TIMEOUT_MS = 30000
const DEBUG = process.env.COUPANG_DEBUG === '1'

function getKSTDate() {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

// Page에서 검색 결과 product_id 리스트(노출 순서대로) 추출 — 4단계 폴백
async function extractProductIds(page) {
  return await page.evaluate(() => {
    const seen = new Set()
    const out = []
    function add(id) {
      const s = String(id || '').trim()
      if (s && /^\d+$/.test(s) && !seen.has(s)) {
        seen.add(s); out.push(s)
      }
    }
    // A: <li class="search-product" data-product-id="...">
    document.querySelectorAll('li.search-product[data-product-id]').forEach(el =>
      add(el.getAttribute('data-product-id')))
    if (out.length) return { ids: out, strategy: 'A' }
    // B: 어떤 태그든 data-product-id
    document.querySelectorAll('[data-product-id]').forEach(el =>
      add(el.getAttribute('data-product-id')))
    if (out.length) return { ids: out, strategy: 'B' }
    // C: /vp/products/{id} URL의 a 태그
    document.querySelectorAll('a[href*="/vp/products/"]').forEach(a => {
      const m = a.getAttribute('href')?.match(/\/vp\/products\/(\d+)/)
      if (m) add(m[1])
    })
    if (out.length) return { ids: out, strategy: 'C' }
    // D: 페이지 전체 HTML에서 정규식
    const html = document.documentElement.outerHTML
    const re = /\/vp\/products\/(\d+)/g
    let m
    while ((m = re.exec(html)) !== null) add(m[1])
    return { ids: out, strategy: 'D' }
  })
}

async function findRankForKeyword(context, keyword, productId) {
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const url = `${COUPANG_SEARCH}?q=${encodeURIComponent(keyword)}&listSize=${PAGE_SIZE}&page=${pageNum}`
    const page = await context.newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
      // 검색 결과 카드가 한 개라도 그려질 때까지 짧게 대기 (최대 5초)
      await page.waitForSelector('a[href*="/vp/products/"], li.search-product, [data-product-id]', { timeout: 5000 }).catch(() => {})
      const { ids, strategy } = await extractProductIds(page)
      if (DEBUG) console.log(`[coupang]   "${keyword}" p${pageNum}: ${ids.length} items via ${strategy}`)
      if (!ids.length) {
        const html = await page.content()
        const isBlock = /captcha|robot|차단|access\s+denied|보안문자/i.test(html)
        const isEmpty = /검색결과가\s*없|no\s+results/i.test(html)
        console.warn(`[coupang]   ⚠️ "${keyword}" p${pageNum}: 0 items. block=${isBlock} empty=${isEmpty} length=${html.length}`)
        if (DEBUG) console.warn('[coupang]   preview:\n', html.slice(0, 1500))
        return null
      }
      const idx = ids.indexOf(String(productId))
      if (idx >= 0) {
        const rank = (pageNum - 1) * PAGE_SIZE + idx + 1
        return { rank, rating: null, reviewCount: null }
      }
    } catch (e) {
      console.warn(`[coupang]   "${keyword}" p${pageNum} 에러:`, e.message)
    } finally {
      await page.close()
    }
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS))
  }
  return null
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
  await deleteWhere('keyword_rankings', `date=eq.${today}`)
  console.log(`[coupang] cleared existing rows for ${today}`)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    },
  })
  // navigator.webdriver 흔적 제거 (간단한 stealth)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  const rows = []
  let success = 0, missing = 0, errors = 0

  try {
    for (const k of keywords) {
      try {
        const result = await findRankForKeyword(context, k.keyword, String(k.coupang_product_id))
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
          rows.push({
            keyword_id: k.id,
            date: today,
            rank_position: 999,
            rating: null,
            review_count: null,
          })
          missing++
        }
      } catch (e) {
        errors++
        console.error(`[coupang] "${k.keyword}" error:`, e.message)
      }
    }
  } finally {
    await context.close()
    await browser.close()
  }

  if (rows.length) {
    // 1000건씩 배치로 insert
    for (let i = 0; i < rows.length; i += 500) {
      await insertRows('keyword_rankings', rows.slice(i, i + 500))
    }
    console.log(`[coupang] inserted ${rows.length} rows`)
  }

  console.log(`[coupang] done ${new Date().toISOString()} — success:${success} missing:${missing} errors:${errors}`)
}

main().catch(e => {
  console.error('[coupang] fatal:', e)
  process.exit(1)
})

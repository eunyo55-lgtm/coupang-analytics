// 키워드별 barcode 매핑 + 최근 14일 일별 판매량 확인
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = {}
const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// 1) 화면에 보이는 상품들의 barcode 가져옴 (products 테이블)
const targets = ['샌들-톡톡', '샌들-브리드', '아우터-스무디아인']
for (const productName of targets) {
  console.log(`\n=== 상품: "${productName}" ===`)
  const pr = await fetch(`${URL}/rest/v1/products?select=barcode,name,option_value&name=ilike.*${encodeURIComponent(productName)}*&limit=20`, { headers: H })
  const products = await pr.json()
  if (!Array.isArray(products) || products.length === 0) {
    console.log('  → products에서 못 찾음')
    continue
  }
  for (const p of products) {
    console.log(`  barcode=${p.barcode} option=${p.option_value || '-'}`)
  }

  const barcodes = products.map(p => p.barcode).filter(Boolean)
  if (barcodes.length === 0) continue
  const inList = barcodes.map(b => `"${b}"`).join(',')

  // 2) 최근 14일 daily_sales
  const today = new Date()
  const since = new Date(today.getTime() - 14 * 86400_000).toISOString().slice(0, 10)
  const todayStr = today.toISOString().slice(0, 10)
  const dr = await fetch(`${URL}/rest/v1/daily_sales?select=date,barcode,quantity&barcode=in.(${encodeURIComponent(inList)})&date=gte.${since}&order=date.asc&limit=10000`, { headers: H })
  const sales = await dr.json()
  if (!Array.isArray(sales)) { console.log('  → daily_sales 오류'); continue }

  // 날짜별 합계
  const byDate = {}
  for (const s of sales) {
    const d = String(s.date).slice(0, 10)
    byDate[d] = (byDate[d] || 0) + Number(s.quantity || 0)
  }
  console.log(`  최근 14일 일별 합계:`)
  const dates = Object.keys(byDate).sort()
  for (const d of dates) {
    console.log(`    ${d}: ${byDate[d]}개`)
  }

  // 화면의 7일/7일 윈도우 계산
  const today6 = new Date(today.getTime() - 6 * 86400_000).toISOString().slice(0, 10)
  const lwe = new Date(today.getTime() - 7 * 86400_000).toISOString().slice(0, 10)
  const lws = new Date(today.getTime() - 13 * 86400_000).toISOString().slice(0, 10)

  let thisWeek = 0, lastWeek = 0
  for (const [d, q] of Object.entries(byDate)) {
    if (d >= today6 && d <= todayStr) thisWeek += q
    else if (d >= lws && d <= lwe) lastWeek += q
  }
  console.log(`  >> 이번주 (${today6} ~ ${todayStr}): ${thisWeek}`)
  console.log(`  >> 전주 (${lws} ~ ${lwe}): ${lastWeek}`)
}

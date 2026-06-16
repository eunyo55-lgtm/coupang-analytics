// 광고 데이터와 products 매칭 진단
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

// 1. coupang_ad_daily 샘플 확인
const adR = await fetch(`${URL}/rest/v1/coupang_ad_daily?select=date,conv_option_id,ad_option_id,units_14d,revenue_14d&date=gte.2026-06-09&date=lte.2026-06-15&limit=10`, { headers: H })
const adSample = await adR.json()
console.log('=== coupang_ad_daily 샘플 10건 ===')
console.log(adSample.slice(0, 5))

// 2. unique option_id 모두 수집
const allAdR = await fetch(`${URL}/rest/v1/coupang_ad_daily?select=conv_option_id,ad_option_id&date=gte.2026-06-09&date=lte.2026-06-15&limit=10000`, { headers: H })
const allAd = await allAdR.json()
const convIds = Array.from(new Set(allAd.map(r => String(r.conv_option_id || '')).filter(Boolean)))
const adIds   = Array.from(new Set(allAd.map(r => String(r.ad_option_id   || '')).filter(Boolean)))
console.log(`\n=== unique IDs ===`)
console.log(`conv_option_id (광고 전환): ${convIds.length}개 — sample: ${convIds.slice(0,5).join(', ')}`)
console.log(`ad_option_id (광고 집행):   ${adIds.length}개 — sample: ${adIds.slice(0,5).join(', ')}`)

// 3. products 컬럼 구조 확인
const prodR = await fetch(`${URL}/rest/v1/products?limit=2`, { headers: H })
const prodSample = await prodR.json()
console.log(`\n=== products 첫 행 키: ===`)
if (prodSample.length > 0) {
  console.log(Object.keys(prodSample[0]))
  console.log('sample row:', prodSample[0])
}

// 4. products에 옵션ID로 매칭 시도
console.log(`\n=== 매칭 테스트 ===`)
const testIds = convIds.slice(0, 10)
const testInList = testIds.map(b => `"${b}"`).join(',')
const matchR = await fetch(`${URL}/rest/v1/products?select=barcode,name,cost&barcode=in.(${encodeURIComponent(testInList)})`, { headers: H })
const matched = await matchR.json()
console.log(`conv_option_id ${testIds.length}개 → products.barcode 매칭: ${matched.length}건`)
if (matched.length > 0) console.log('matched sample:', matched.slice(0, 3))

// 5. keywords 테이블에서 매핑 시도 (keywords.coupang_product_id + barcode)
const kwR = await fetch(`${URL}/rest/v1/keywords?select=coupang_product_id,barcode&limit=5`, { headers: H })
const kwSample = await kwR.json()
console.log(`\n=== keywords 테이블 샘플 ===`)
console.log(kwSample)

// 광고 CSV 상품명 vs products.name 매칭 가능성 확인
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

// 광고 CSV: conv_product_name + conv_option_id + units_14d
const adR = await fetch(`${URL}/rest/v1/coupang_ad_daily?select=conv_product_name,conv_option_id,units_14d&date=gte.2026-06-09&date=lte.2026-06-15&limit=20000`, { headers: H })
const adRows = await adR.json()
console.log(`광고 CSV: ${adRows.length}행`)

const byName = new Map()
for (const r of adRows) {
  const name = String(r.conv_product_name || '').trim()
  if (!name) continue
  byName.set(name, (byName.get(name) || 0) + Number(r.units_14d || 0))
}
const adNames = Array.from(byName.keys())
console.log(`unique 광고 전환 상품명: ${adNames.length}개`)
console.log('sample 5:', adNames.slice(0, 5))

// products 전체 이름 수집
let offset = 0
const productNames = new Set()
while (true) {
  const pr = await fetch(`${URL}/rest/v1/products?select=name&limit=1000&offset=${offset}`, { headers: H })
  const data = await pr.json()
  if (!Array.isArray(data) || data.length === 0) break
  for (const p of data) if (p.name) productNames.add(String(p.name))
  if (data.length < 1000) break
  offset += 1000
  if (offset > 50000) break
}
console.log(`\nproducts 테이블 unique name: ${productNames.size}개`)
console.log('sample 5:', Array.from(productNames).slice(0, 5))

// 정확 매칭
let exact = 0
for (const n of adNames) if (productNames.has(n)) exact++
console.log(`\n=== 정확 매칭 ===`)
console.log(`광고 상품명 ${adNames.length}개 중 products.name 정확 일치: ${exact}건`)

// 부분 매칭 (광고 상품명이 products.name의 일부 포함하는지 또는 반대)
let partialAdInProd = 0
let partialProdInAd = 0
const prodNamesArr = Array.from(productNames)
for (const ad of adNames.slice(0, 100)) {  // 빠른 샘플
  for (const p of prodNamesArr) {
    if (ad.includes(p) && p.length >= 6) { partialProdInAd++; break }
  }
  for (const p of prodNamesArr) {
    if (p.includes(ad) && ad.length >= 6) { partialAdInProd++; break }
  }
}
console.log(`\n=== 부분 매칭 (광고 100개 샘플) ===`)
console.log(`products.name이 광고 상품명에 포함: ${partialProdInAd}건`)
console.log(`광고 상품명이 products.name에 포함: ${partialAdInProd}건`)

// 광고 상품명 / products 이름 비교
console.log(`\n=== 광고 상품명 형식 vs products 형식 비교 ===`)
console.log('광고 (3개):')
adNames.slice(0, 3).forEach(n => console.log('  -', n))
console.log('products (3개):')
prodNamesArr.slice(0, 3).forEach(n => console.log('  -', n))

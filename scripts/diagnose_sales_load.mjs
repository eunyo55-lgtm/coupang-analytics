// SalesPage의 loadHistorical이 실제 얼마나 받아오는지 측정
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

const today = new Date().toISOString().slice(0, 10)
const yearStart = `${new Date().getFullYear()}-01-01`
const ninetyAgo = new Date()
ninetyAgo.setDate(ninetyAgo.getDate() - 90)
const from90 = ninetyAgo.toISOString().slice(0, 10)
const fromLoad = yearStart < from90 ? yearStart : from90

console.log(`다음 기간 daily_sales 조회: ${fromLoad} ~ ${today}`)

// COUNT만 먼저
const t0 = Date.now()
const cnt = await fetch(`${URL}/rest/v1/daily_sales?select=count&date=gte.${fromLoad}&date=lte.${today}&quantity=gt.0`, {
  headers: { ...H, Prefer: 'count=exact' }
})
const total = cnt.headers.get('content-range')
console.log(`daily_sales 행 수: ${total}  (${Date.now()-t0}ms)`)

// 페이지네이션 전체 다운로드 시간 측정
const t1 = Date.now()
let offset = 0, all = 0
while (true) {
  const r = await fetch(
    `${URL}/rest/v1/daily_sales?select=date,barcode,quantity&date=gte.${fromLoad}&date=lte.${today}&quantity=gt.0&order=date.asc&limit=1000&offset=${offset}`,
    { headers: H }
  )
  const arr = await r.json()
  if (!Array.isArray(arr) || arr.length === 0) break
  all += arr.length
  if (arr.length < 1000) break
  offset += 1000
  if (all > 200000) break
}
console.log(`daily_sales 전체 다운로드: ${all}행, ${Date.now()-t1}ms`)

// products 다운로드 시간
const t2 = Date.now()
let pcount = 0, poff = 0
while (true) {
  const r = await fetch(
    `${URL}/rest/v1/products?select=barcode,name,option_value,cost,season,image_url,category,hq_stock&barcode=not.is.null&name=not.is.null&limit=1000&offset=${poff}`,
    { headers: H }
  )
  const arr = await r.json()
  if (!Array.isArray(arr) || arr.length === 0) break
  pcount += arr.length
  if (arr.length < 1000) break
  poff += 1000
}
console.log(`products 전체 다운로드: ${pcount}행, ${Date.now()-t2}ms`)

console.log(`\n>>> 총 소요: ${Date.now()-t0}ms`)
console.log(`>>> 추정 payload: daily_sales ${all}행 × ~80바이트 = ~${Math.round(all*80/1024)}KB`)
console.log(`>>> 추정 payload: products ${pcount}행 × ~180바이트 = ~${Math.round(pcount*180/1024)}KB`)

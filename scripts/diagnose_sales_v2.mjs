// 최적화 후 예상 — 90일 + 16 concurrency + lazy products
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
const back = new Date()
back.setDate(back.getDate() - 90)
const from90 = back.toISOString().slice(0, 10)

console.log(`기간: ${from90} ~ ${today} (90일)`)

// 1) daily_sales 병렬 16
const t0 = Date.now()
let total = 0, off = 0, done = false
const rows = []
while (!done) {
  const offs = Array.from({length: 16}, (_, i) => off + i * 1000)
  const arrs = await Promise.all(offs.map(o =>
    fetch(`${URL}/rest/v1/daily_sales?select=date,barcode,quantity&date=gte.${from90}&date=lte.${today}&quantity=gt.0&order=date.asc&limit=1000&offset=${o}`, { headers: H })
      .then(r => r.json())
  ))
  for (const arr of arrs) {
    if (Array.isArray(arr)) {
      rows.push(...arr)
      if (arr.length < 1000) done = true
    }
  }
  off += 16000
  if (rows.length > 200000) break
}
console.log(`1. daily_sales (90일, 병렬 16): ${rows.length}행, ${Date.now()-t0}ms`)

// 2) Lazy products — 사용된 unique barcode만
const t1 = Date.now()
const barcodes = Array.from(new Set(rows.map(r => r.barcode).filter(Boolean)))
console.log(`   unique barcodes: ${barcodes.length}`)

const CHUNK = 200
const chunks = []
for (let i = 0; i < barcodes.length; i += CHUNK) {
  chunks.push(barcodes.slice(i, i + CHUNK))
}
let allProds = 0
const PARALLEL = 4
for (let i = 0; i < chunks.length; i += PARALLEL) {
  const batch = chunks.slice(i, i + PARALLEL)
  const results = await Promise.all(batch.map(chunk => {
    const inList = chunk.map(b => `"${b}"`).join(',')
    return fetch(`${URL}/rest/v1/products?select=barcode,name,option_value,cost,season,image_url,category,hq_stock&barcode=in.(${encodeURIComponent(inList)})`, { headers: H })
      .then(r => r.json())
  }))
  for (const arr of results) {
    if (Array.isArray(arr)) allProds += arr.length
  }
}
console.log(`2. products (lazy, ${barcodes.length} barcodes, 4 parallel): ${allProds}행, ${Date.now()-t1}ms`)

console.log(`\n>>> 총 소요: ${Date.now()-t0}ms (사용자 첫 진입 시)`)

// 25년 동기간 prev-year 매칭 진단
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

const prevFrom = '2025-05-17'
const prevTo   = '2025-06-15'

console.log(`>>> prev period: ${prevFrom} ~ ${prevTo}`)

// 1) prev daily_sales fetch
let off = 0, done = false
const rows = []
while (!done) {
  const offs = Array.from({length: 8}, (_, i) => off + i * 1000)
  const arrs = await Promise.all(offs.map(o =>
    fetch(`${URL}/rest/v1/daily_sales?select=date,barcode,quantity&date=gte.${prevFrom}&date=lte.${prevTo}&quantity=gt.0&order=date.asc&limit=1000&offset=${o}`, { headers: H })
      .then(r => r.json())
  ))
  for (const arr of arrs) {
    if (Array.isArray(arr)) {
      rows.push(...arr)
      if (arr.length < 1000) done = true
    }
  }
  off += 8000
  if (rows.length > 100000) break
}
console.log(`1. daily_sales 25년 동기간: ${rows.length}행`)
const sampleRow = rows[0]
console.log(`   sample row:`, sampleRow)
const totalQty = rows.reduce((s,r) => s + Number(r.quantity||0), 0)
console.log(`   total qty: ${totalQty.toLocaleString()}`)

const withBarcode = rows.filter(r => r.barcode)
const noBarcode = rows.length - withBarcode.length
console.log(`   barcode 있음: ${withBarcode.length}, 없음: ${noBarcode}`)

const barcodes = Array.from(new Set(withBarcode.map(r => String(r.barcode))))
console.log(`2. unique 25년 barcodes: ${barcodes.length}`)
console.log(`   sample: ${barcodes.slice(0,5).join(', ')}`)

// 2) products fetch for ALL of them
const CHUNK = 200
const chunks = []
for (let i = 0; i < barcodes.length; i += CHUNK) chunks.push(barcodes.slice(i, i + CHUNK))

const matched = []
for (let i = 0; i < chunks.length; i += 4) {
  const batch = chunks.slice(i, i + 4)
  const results = await Promise.all(batch.map(chunk => {
    const inList = chunk.map(b => `"${b}"`).join(',')
    return fetch(`${URL}/rest/v1/products?select=barcode,name,season,category&barcode=in.(${encodeURIComponent(inList)})`, { headers: H })
      .then(r => r.json())
  }))
  for (const arr of results) {
    if (Array.isArray(arr)) matched.push(...arr)
  }
}
console.log(`3. products 매칭: ${matched.length}건 / ${barcodes.length} barcodes`)
const matchedBcSet = new Set(matched.map(p => String(p.barcode)))
const unmatchedBc = barcodes.filter(b => !matchedBcSet.has(b))
console.log(`   매칭 안된 barcode: ${unmatchedBc.length}개`)
console.log(`   매칭 안된 sample: ${unmatchedBc.slice(0,10).join(', ')}`)

// 매칭된 것 중 season/name 비어있는 비율
const withSeason = matched.filter(p => p.season && String(p.season).trim())
const withName   = matched.filter(p => p.name && String(p.name).trim())
console.log(`4. 매칭된 products:`)
console.log(`   season 채워진 것: ${withSeason.length}/${matched.length}`)
console.log(`   name 채워진 것:   ${withName.length}/${matched.length}`)
console.log(`   sample matched:`, matched.slice(0,3))

// 매칭 안된 25년 barcode의 daily_sales 수량 합
const unmatchedSet = new Set(unmatchedBc)
const unmatchedQty = withBarcode.filter(r => unmatchedSet.has(String(r.barcode)))
  .reduce((s,r) => s + Number(r.quantity||0), 0)
console.log(`5. 매칭 실패 25년 qty 합: ${unmatchedQty.toLocaleString()} / ${totalQty.toLocaleString()}`)

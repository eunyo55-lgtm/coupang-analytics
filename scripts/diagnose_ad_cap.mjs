// 일별로 광고 매출이 일별 총 매출을 초과하는지 확인 (cap 영향)
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

// 6/10~6/16 광고 일별 합계
const ad = {}
let off = 0
while (true) {
  const r = await fetch(`${URL}/rest/v1/coupang_ad_daily?select=date,revenue_14d,ad_cost,units_14d&date=gte.2026-06-10&date=lte.2026-06-16&limit=1000&offset=${off}`, { headers: H })
  const data = await r.json()
  if (!Array.isArray(data) || data.length === 0) break
  for (const row of data) {
    const d = String(row.date)
    if (!ad[d]) ad[d] = { rev: 0, cost: 0, qty: 0 }
    ad[d].rev += Number(row.revenue_14d || 0) / 1.1
    ad[d].cost += Number(row.ad_cost || 0) / 1.1
    ad[d].qty += Number(row.units_14d || 0)
  }
  if (data.length < 1000) break
  off += 1000
}

// daily_sales × sale_price 일별 합계
const sales = {}
let off2 = 0
while (true) {
  const r = await fetch(`${URL}/rest/v1/daily_sales?select=date,barcode,quantity&date=gte.2026-06-10&date=lte.2026-06-16&quantity=gt.0&limit=1000&offset=${off2}`, { headers: H })
  const data = await r.json()
  if (!Array.isArray(data) || data.length === 0) break
  for (const row of data) {
    const d = String(row.date)
    if (!sales[d]) sales[d] = { qty: 0, barcodes: [] }
    sales[d].qty += Number(row.quantity || 0)
    sales[d].barcodes.push({ b: row.barcode, q: Number(row.quantity || 0) })
  }
  if (data.length < 1000) break
  off2 += 1000
}

// products.sale_price 조회 — 모든 barcode 모은 후 조회
const allBc = new Set()
for (const d in sales) sales[d].barcodes.forEach(r => allBc.add(r.b))
const bcList = Array.from(allBc).filter(Boolean)
const priceMap = new Map()
const CHUNK = 200
for (let i = 0; i < bcList.length; i += CHUNK) {
  const chunk = bcList.slice(i, i + CHUNK)
  const inList = chunk.map(b => `"${b}"`).join(',')
  const r = await fetch(`${URL}/rest/v1/products?select=barcode,sale_price,cost&barcode=in.(${encodeURIComponent(inList)})`, { headers: H })
  const data = await r.json()
  for (const p of data) {
    const price = Number(p.sale_price) > 0 ? Number(p.sale_price) : Number(p.cost || 0)
    priceMap.set(String(p.barcode), price / 1.1)  // VAT 별도
  }
}

// 일별 총 매출 (sale_price × qty)
const dailyTotal = {}
for (const d in sales) {
  let rev = 0
  for (const { b, q } of sales[d].barcodes) {
    rev += (priceMap.get(b) || 0) * q
  }
  dailyTotal[d] = rev
}

console.log('date       | total(판매가) | ad(14d 별도) | 광고>총? | cap 후 ad')
console.log('-----------+---------------+--------------+----------+-----------')
const dates = Object.keys({...ad, ...dailyTotal}).sort()
let totalSum = 0, adRaw = 0, adCapped = 0, costSum = 0
for (const d of dates) {
  const t = dailyTotal[d] || 0
  const a = ad[d]?.rev || 0
  const c = ad[d]?.cost || 0
  const exceeds = a > t ? '⚠️ YES' : '   no'
  const aCap = Math.min(a, t)
  totalSum += t
  adRaw += a
  adCapped += aCap
  costSum += c
  console.log(`${d} | ${Math.round(t).toLocaleString().padStart(13)} | ${Math.round(a).toLocaleString().padStart(12)} | ${exceeds} | ${Math.round(aCap).toLocaleString()}`)
}
console.log('-----------+---------------+--------------+----------+-----------')
console.log(`합계        | ${Math.round(totalSum).toLocaleString().padStart(13)} | ${Math.round(adRaw).toLocaleString().padStart(12)} |          | ${Math.round(adCapped).toLocaleString()}`)
console.log(`광고비 (VAT 별도): ${Math.round(costSum).toLocaleString()}원`)
console.log()
console.log(`광고 매출 (raw 합): ${Math.round(adRaw).toLocaleString()}원 — 외부 90M과 매칭`)
console.log(`광고 매출 (cap 후): ${Math.round(adCapped).toLocaleString()}원 — UI 카드 표시값`)
console.log(`차이: ${Math.round(adRaw - adCapped).toLocaleString()}원 — 광고 > 일별 총매출인 날에 잘림`)

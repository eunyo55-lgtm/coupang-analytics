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

// 6/10~6/16 광고 row 페이지네이션 — 모두 가져오기
const allAdRows = []
let off = 0
while (true) {
  const r = await fetch(`${URL}/rest/v1/coupang_ad_daily?select=date,revenue_14d,ad_cost&date=gte.2026-06-10&date=lte.2026-06-16&order=date.asc&limit=1000&offset=${off}`, { headers: H })
  const data = await r.json()
  if (!Array.isArray(data) || data.length === 0) break
  allAdRows.push(...data)
  if (data.length < 1000) break
  off += 1000
}
console.log(`광고 CSV row 수 (6/10~6/16): ${allAdRows.length}`)

// 일별 집계
const ad = {}
for (const row of allAdRows) {
  const d = String(row.date)
  if (!ad[d]) ad[d] = { rev: 0, cost: 0, rows: 0 }
  ad[d].rev += Number(row.revenue_14d || 0)
  ad[d].cost += Number(row.ad_cost || 0)
  ad[d].rows++
}
console.log('\n=== 일별 광고 (raw, VAT 포함) ===')
for (const d of Object.keys(ad).sort()) {
  console.log(`${d}: ${ad[d].rows}행 / 매출 ${Math.round(ad[d].rev).toLocaleString()}원 / 광고비 ${Math.round(ad[d].cost).toLocaleString()}원`)
}
let totalRev = 0, totalCost = 0
for (const d in ad) { totalRev += ad[d].rev; totalCost += ad[d].cost }
console.log(`\n총 광고 매출 (VAT 포함): ${Math.round(totalRev).toLocaleString()}원`)
console.log(`총 광고 매출 (VAT 별도): ${Math.round(totalRev/1.1).toLocaleString()}원`)
console.log(`총 광고비 (VAT 포함): ${Math.round(totalCost).toLocaleString()}원`)
console.log(`총 광고비 (VAT 별도): ${Math.round(totalCost/1.1).toLocaleString()}원`)

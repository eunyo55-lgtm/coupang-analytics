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

// Range 헤더로 페이지네이션 - supabase-js .range() 와 동일한 방식
let off = 0
const PAGE = 1000
let total = 0, revSum = 0, costSum = 0
while (true) {
  const r = await fetch(
    `${URL}/rest/v1/coupang_ad_daily?select=date,revenue_14d,ad_cost&date=gte.2026-06-10&date=lte.2026-06-16&order=date.asc`,
    {
      headers: {
        ...H,
        'Range-Unit': 'items',
        'Range': `${off}-${off + PAGE - 1}`,  // supabase-js .range() 와 동일
      }
    }
  )
  const data = await r.json()
  const status = r.status
  const contentRange = r.headers.get('content-range')
  if (!Array.isArray(data)) {
    console.log(`off=${off}: error or empty`, data)
    break
  }
  console.log(`off=${off}~${off+PAGE-1}: ${data.length}행 | status=${status} | content-range=${contentRange}`)
  for (const row of data) {
    revSum += Number(row.revenue_14d || 0)
    costSum += Number(row.ad_cost || 0)
  }
  total += data.length
  if (data.length < PAGE) break
  off += PAGE
  if (off > 50000) break
}
console.log(`\n총 ${total}행`)
console.log(`광고 매출 (VAT 포함): ${Math.round(revSum).toLocaleString()}원`)
console.log(`광고비 (VAT 포함): ${Math.round(costSum).toLocaleString()}원`)

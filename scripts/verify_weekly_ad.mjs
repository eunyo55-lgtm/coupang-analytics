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

// 최근 7일 (6/11 ~ 6/17, 오늘 6/17)
const periods = [
  { name: '최근 7일 (06-11~06-17)',     from: '2026-06-11', to: '2026-06-17' },
  { name: '지난주 (06-05~06-11 금~목)', from: '2026-06-05', to: '2026-06-11' },
  { name: '6/9~6/15 (월~일)',           from: '2026-06-09', to: '2026-06-15' },
  { name: '6/10~6/16',                  from: '2026-06-10', to: '2026-06-16' },
]

for (const p of periods) {
  // coupang_ad_daily 합계
  let revSum14 = 0, costSum = 0, qtySum14 = 0
  let revSum1 = 0
  let off = 0
  while (true) {
    const r = await fetch(`${URL}/rest/v1/coupang_ad_daily?select=date,revenue_14d,revenue_1d,units_14d,ad_cost&date=gte.${p.from}&date=lte.${p.to}&limit=1000&offset=${off}`, { headers: H })
    const data = await r.json()
    if (!Array.isArray(data) || data.length === 0) break
    for (const row of data) {
      revSum14 += Number(row.revenue_14d || 0)
      revSum1  += Number(row.revenue_1d || 0)
      costSum  += Number(row.ad_cost || 0)
      qtySum14 += Number(row.units_14d || 0)
    }
    if (data.length < 1000) break
    off += 1000
  }
  console.log(`\n=== ${p.name} ===`)
  console.log(`광고 매출 (14일 어트리뷰션, VAT 포함): ${Math.round(revSum14).toLocaleString()}원`)
  console.log(`광고 매출 (14일 어트리뷰션, VAT 별도): ${Math.round(revSum14/1.1).toLocaleString()}원`)
  console.log(`광고 매출 (1일 어트리뷰션, VAT 포함):  ${Math.round(revSum1).toLocaleString()}원`)
  console.log(`광고 매출 (1일 어트리뷰션, VAT 별도):  ${Math.round(revSum1/1.1).toLocaleString()}원`)
  console.log(`광고비 (VAT 포함): ${Math.round(costSum).toLocaleString()}원`)
  console.log(`광고비 (VAT 별도): ${Math.round(costSum/1.1).toLocaleString()}원`)
  console.log(`광고 판매수량 (14일): ${qtySum14.toLocaleString()}개`)
}

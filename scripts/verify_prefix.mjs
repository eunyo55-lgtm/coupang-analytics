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

// sale_price > 0인 상품의 대표코드 5개 가져오기
const r1 = await fetch(`${URL}/rest/v1/products?select=barcode,name,sale_price&sale_price=gt.0&limit=5&order=updated_at.desc`, { headers: H })
const reps = await r1.json()
console.log('=== sale_price 들어간 대표 코드 ===')
for (const r of reps) {
  console.log(`  ${r.barcode} | ${r.name} | sale_price: ${r.sale_price}`)
  // 이 prefix로 시작하는 옵션-level barcode 찾기
  const prefix = r.barcode
  const r2 = await fetch(`${URL}/rest/v1/products?select=barcode,name,cost,sale_price&barcode=like.${prefix}*&limit=10`, { headers: H })
  const opts = await r2.json()
  console.log(`    → "${prefix}*" 으로 시작하는 옵션 수: ${opts.length}`)
  opts.slice(0, 3).forEach(o => console.log(`      ${o.barcode} | cost:${o.cost} | sale:${o.sale_price}`))
}

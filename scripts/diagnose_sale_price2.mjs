// 정상 상품의 sale_price 확인 (cost > 0 인 것만)
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

const r = await fetch(`${URL}/rest/v1/products?select=barcode,name,cost,sale_price&cost=gt.0&limit=10&order=updated_at.desc`, { headers: H })
const data = await r.json()
console.log('정상 상품 샘플 10건 (최근 업데이트 순):')
data.forEach(p => {
  console.log(`  ${p.barcode} | ${p.name} | cost: ${p.cost} | sale_price: ${p.sale_price}`)
})

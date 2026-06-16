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

// 직접 fetch — sale_price > 0 인 것 100개
const r = await fetch(`${URL}/rest/v1/products?select=barcode,sale_price&sale_price=gt.0&limit=200`, { headers: H })
const data = await r.json()
console.log('sale_price > 0 first 200건:', data.length)
console.log('첫 10건:', data.slice(0, 10))

// 페이지네이션으로 정확히 카운트
let total = 0, off = 0
while (true) {
  const r2 = await fetch(`${URL}/rest/v1/products?select=barcode&sale_price=gt.0&limit=1000&offset=${off}`, { headers: H })
  const d2 = await r2.json()
  total += d2.length
  if (d2.length < 1000) break
  off += 1000
  if (off > 50000) break
}
console.log('정확한 sale_price > 0 행 수:', total)

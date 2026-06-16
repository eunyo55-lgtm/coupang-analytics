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

// Range 헤더로 정확 카운트
async function count(filter) {
  const r = await fetch(`${URL}/rest/v1/products?select=barcode&${filter}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Prefer': 'count=exact', 'Range': '0-0' }
  })
  const cr = r.headers.get('content-range')
  return cr?.split('/')[1] || '?'
}
console.log('sale_price > 0 :', await count('sale_price=gt.0'))
console.log('sale_price >= 1000 :', await count('sale_price=gte.1000'))
console.log('cost > 0 :', await count('cost=gt.0'))
console.log('total :', await count(''))

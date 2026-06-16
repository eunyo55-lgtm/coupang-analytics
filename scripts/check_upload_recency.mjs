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

// 가장 최근 updated_at 5건
const r = await fetch(`${URL}/rest/v1/products?select=barcode,name,cost,sale_price,updated_at&order=updated_at.desc&limit=5`, { headers: H })
const recent = await r.json()
console.log('=== 가장 최근 update 된 products 5건 ===')
recent.forEach(p => {
  console.log(`  ${p.updated_at} | ${p.barcode} | cost=${p.cost} | sale_price=${p.sale_price}`)
})

// 오늘 update 된 행 카운트
const today = new Date().toISOString().slice(0, 10)
const r2 = await fetch(`${URL}/rest/v1/products?select=barcode&updated_at=gte.${today}&limit=1000`, { headers: H })
const todayRows = await r2.json()
console.log(`\n오늘(${today}) update 된 행: ${todayRows.length}+`)

// 어제 update
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
const r3 = await fetch(`${URL}/rest/v1/products?select=barcode&updated_at=gte.${yesterday}&updated_at=lt.${today}&limit=1000`, { headers: H })
const yRows = await r3.json()
console.log(`어제(${yesterday}) update 된 행: ${yRows.length}+`)

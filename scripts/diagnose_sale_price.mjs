// sale_price 컬럼 + 데이터 진단
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

// 1. sale_price 컬럼 존재 확인 (select에 포함)
const r1 = await fetch(`${URL}/rest/v1/products?select=barcode,cost,sale_price&limit=5`, { headers: H })
console.log('[1] sale_price 컬럼 조회 HTTP:', r1.status)
if (r1.ok) {
  const data = await r1.json()
  console.log('샘플 5건:', data)
} else {
  console.log('에러:', await r1.text())
  console.log('→ sale_price 컬럼이 아직 존재하지 않을 가능성. SQL 마이그레이션 실행 필요')
}

// 2. sale_price > 0 인 행 카운트
const r2 = await fetch(`${URL}/rest/v1/products?select=barcode&sale_price=gt.0&limit=1`, {
  headers: { ...H, 'Prefer': 'count=exact' }
})
if (r2.ok) {
  const total = r2.headers.get('content-range')?.split('/')[1]
  console.log(`\n[2] sale_price > 0 인 상품 수: ${total}`)
}

// 3. cost > 0 인 행 카운트 (비교)
const r3 = await fetch(`${URL}/rest/v1/products?select=barcode&cost=gt.0&limit=1`, {
  headers: { ...H, 'Prefer': 'count=exact' }
})
if (r3.ok) {
  const total = r3.headers.get('content-range')?.split('/')[1]
  console.log(`[3] cost > 0 인 상품 수: ${total}`)
}

// 4. 총 products 행 수
const r4 = await fetch(`${URL}/rest/v1/products?select=barcode&limit=1`, {
  headers: { ...H, 'Prefer': 'count=exact' }
})
if (r4.ok) {
  const total = r4.headers.get('content-range')?.split('/')[1]
  console.log(`[4] 전체 products: ${total}`)
}

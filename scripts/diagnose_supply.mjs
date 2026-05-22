// supply_status 테이블의 최근 입고예정일 분포
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

// 컬럼 확인 + 최근 입고예정일 20개
const r1 = await fetch(`${URL}/rest/v1/supply_status?select=입고예정일,발주수량,확정수량&입고예정일=gte.2026-05-01&order=입고예정일.desc&limit=2000`, { headers: H })
const rows = await r1.json()
console.log('row 수:', rows.length)
const dateSet = new Set(rows.map(r => String(r.입고예정일).slice(0,10)))
const sortedDates = Array.from(dateSet).sort()
console.log('\n5월 이후 등장하는 입고예정일 (오름차순):')
for (const d of sortedDates) {
  const cnt = rows.filter(r => String(r.입고예정일).slice(0,10) === d).length
  console.log(`  ${d}: ${cnt}건`)
}
console.log('\n>>>> 가장 미래 입고예정일:', sortedDates[sortedDates.length - 1])

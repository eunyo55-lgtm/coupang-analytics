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

// 1. coupang_category_rankings 전체 카운트
let r = await fetch(`${URL}/rest/v1/coupang_category_rankings?select=id&limit=1`, {
  headers: { ...H, 'Prefer': 'count=exact' }
})
console.log('전체 row 수 헤더:', r.headers.get('content-range'))

// 2. 가장 최근 measured_date
const r2 = await fetch(`${URL}/rest/v1/coupang_category_rankings?select=measured_date&order=measured_date.desc&limit=5`, { headers: H })
const data2 = await r2.json()
console.log('\n=== 최근 measured_date 5건 ===')
console.log(data2)

// 3. 최근 5개 row 샘플
const r3 = await fetch(`${URL}/rest/v1/coupang_category_rankings?select=*&order=measured_at.desc&limit=5`, { headers: H })
const data3 = await r3.json()
console.log('\n=== 최근 5건 ===')
console.log(JSON.stringify(data3, null, 2))

// 4. ranking_jobs 최근 5개 (특히 coupang_category)
const r4 = await fetch(`${URL}/rest/v1/ranking_jobs?select=*&job_type=eq.coupang_category&order=created_at.desc&limit=5`, { headers: H })
const data4 = await r4.json()
console.log('\n=== ranking_jobs (coupang_category) 최근 5건 ===')
data4.forEach(j => {
  console.log(`- ${j.id}: ${j.status} (created ${j.created_at}, finished ${j.finished_at})`)
  if (j.error) console.log(`  error: ${j.error}`)
  if (j.logs) console.log(`  logs(last 500): ${j.logs.slice(-500)}`)
})

// 특정 키워드 시계열 (컬럼 자동 탐지)
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

// 컬럼 탐지
const probe = await fetch(`${URL}/rest/v1/keyword_search_volumes?limit=1`, { headers: H })
const sample = await probe.json()
if (Array.isArray(sample) && sample[0]) {
  console.log('컬럼:', Object.keys(sample[0]).join(', '))
}
console.log('')

const targets = ['아기샌들','여아수영복','여아원피스','유아샌들','유아수영복','키즈바람막이','키즈샌들']

for (const kw of targets) {
  const r = await fetch(
    `${URL}/rest/v1/keyword_search_volumes?select=*&keyword=eq.${encodeURIComponent(kw)}&target_date=gte.2026-05-07&target_date=lte.2026-05-20&order=target_date.asc&limit=100`,
    { headers: H }
  )
  const data = await r.json()
  if (!Array.isArray(data)) { console.log(kw, ': error', JSON.stringify(data).slice(0,200)); continue }
  console.log(`\n=== "${kw}" (${data.length} rows) ===`)
  for (const x of data) {
    const d = String(x.target_date).slice(0, 10)
    console.log(`  ${d}: total=${x.total_volume}  ${JSON.stringify(x).slice(0, 200)}`)
  }
}

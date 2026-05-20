// 키워드 검색량 데이터 — 최근 30일 분포 + 가장 최신 일자
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = {}
try {
  const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch (e) { console.error(e); process.exit(1) }

const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// 1) 최근 60일치 target_date별 row 개수
const since = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
const url = `${URL}/rest/v1/keyword_search_volumes?select=target_date&target_date=gte.${since}&order=target_date.desc&limit=10000`
const r = await fetch(url, { headers: H })
const rows = await r.json()
console.log(`총 row: ${rows.length}`)

const counts = {}
for (const x of rows) {
  const d = String(x.target_date).slice(0, 10)
  counts[d] = (counts[d] || 0) + 1
}

console.log('\n날짜별 row 분포 (최근 30일):')
const sorted = Object.entries(counts).sort(([a],[b]) => b.localeCompare(a))
for (const [d, c] of sorted.slice(0, 30)) {
  console.log(`  ${d}: ${c}건`)
}

console.log(`\n가장 최신 target_date: ${sorted[0]?.[0] ?? '(none)'}`)
console.log(`현재 KST 일자: ${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}`)

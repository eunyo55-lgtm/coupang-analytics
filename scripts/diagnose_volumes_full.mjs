// 차트 컴포넌트가 보는 것과 똑같은 쿼리를 재현
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

// 1. tracked keywords
const kwRes = await fetch(`${URL}/rest/v1/keywords?select=keyword`, { headers: H })
const kws = await kwRes.json()
const tracked = Array.from(new Set(kws.map(k => k.keyword).filter(Boolean)))
console.log(`tracked keywords: ${tracked.length}개`)
console.log(`  예시: ${tracked.slice(0, 5).join(', ')}...`)
console.log('')

// 2. 60일 since (KST 기준)
const now = new Date()
const k = new Date(now.getTime() + 9 * 3600_000)
const since = new Date(k.getTime() - 60 * 86400_000).toISOString().slice(0, 10)
const todayKst = k.toISOString().slice(0, 10)
console.log(`since (60일 전 KST): ${since}`)
console.log(`today KST:           ${todayKst}`)
console.log('')

// 3. 차트가 쓰는 쿼리와 동일 + limit 20000
const inList = tracked.map(k => `"${k}"`).join(',')
const q = `${URL}/rest/v1/keyword_search_volumes?select=keyword,target_date,total_volume&keyword=in.(${encodeURIComponent(inList)})&target_date=gte.${since}&order=target_date.asc&limit=20000`
const r = await fetch(q, { headers: H })
const rows = await r.json()
console.log(`limit=20000 응답 rows: ${rows.length}`)

const dates = new Set(rows.map(x => String(x.target_date).slice(0, 10)))
const sorted = Array.from(dates).sort()
console.log(`데이터 범위: ${sorted[0]} ~ ${sorted[sorted.length - 1]}`)
console.log('')

// 4. 최근 10일치 분포
console.log('최근 10일치 row 수:')
const counts = {}
for (const x of rows) {
  const d = String(x.target_date).slice(0, 10)
  counts[d] = (counts[d] || 0) + 1
}
const recentDates = Object.entries(counts).sort(([a],[b]) => b.localeCompare(a)).slice(0, 10)
for (const [d, c] of recentDates) console.log(`  ${d}: ${c}건`)

// 5. limit 없을 때 (PostgREST 기본 1000)
console.log('')
const qNoLimit = `${URL}/rest/v1/keyword_search_volumes?select=keyword,target_date,total_volume&keyword=in.(${encodeURIComponent(inList)})&target_date=gte.${since}&order=target_date.asc`
const r2 = await fetch(qNoLimit, { headers: H })
const rows2 = await r2.json()
console.log(`limit 없을 때 응답: ${rows2.length} rows`)
const sortedNoLimit = rows2.map(x => String(x.target_date).slice(0, 10)).sort()
console.log(`  날짜 범위: ${sortedNoLimit[0]} ~ ${sortedNoLimit[sortedNoLimit.length - 1]}`)

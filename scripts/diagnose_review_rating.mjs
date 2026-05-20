// keyword_rankings 테이블에 rating/review_count 데이터가 들어오는지 확인
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

// 컬럼 + 최신 rows 샘플
const r = await fetch(`${URL}/rest/v1/keyword_rankings?select=*&order=date.desc&limit=10`, { headers: H })
const rows = await r.json()
if (!Array.isArray(rows) || rows.length === 0) {
  console.log('no rows')
  process.exit(0)
}
console.log('컬럼:', Object.keys(rows[0]).join(', '))
console.log('')
console.log('최근 10개:')
for (const x of rows) {
  console.log(`  date=${String(x.date).slice(0,10)} kw_id=${x.keyword_id} rank=${x.rank_position} rating=${x.rating} reviews=${x.review_count}`)
}

// rating > 0 / review_count > 0 비율
const rAll = await fetch(`${URL}/rest/v1/keyword_rankings?select=rating,review_count&date=gte.2026-05-15&limit=1000`, { headers: H })
const recent = await rAll.json()
const nonZeroRating = recent.filter(x => x.rating && x.rating > 0).length
const nonZeroReview = recent.filter(x => x.review_count && x.review_count > 0).length
console.log('')
console.log(`최근 5/15+ 총 ${recent.length}건 중:`)
console.log(`  rating > 0: ${nonZeroRating}건 (${(nonZeroRating/recent.length*100).toFixed(0)}%)`)
console.log(`  review_count > 0: ${nonZeroReview}건 (${(nonZeroReview/recent.length*100).toFixed(0)}%)`)

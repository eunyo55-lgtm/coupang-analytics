// 5/26 키워드별 랭킹 + KPI 구간별 카운트
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

// 1) 등록 키워드 수
const kw = await (await fetch(`${URL}/rest/v1/keywords?select=id,keyword`, { headers: H })).json()
console.log(`등록 키워드: ${kw.length}개`)
const kwMap = new Map(kw.map(k => [k.id, k.keyword]))

// 2) 5/26 랭킹 전수
const r = await (await fetch(`${URL}/rest/v1/keyword_rankings?select=keyword_id,rank_position,updated_at&date=eq.2026-05-26&order=updated_at.desc&limit=5000`, { headers: H })).json()
console.log(`5/26 row 수: ${r.length}`)
console.log('')

// 3) keyword_id 별 중복 체크
const byKw = {}
for (const x of r) {
  if (!byKw[x.keyword_id]) byKw[x.keyword_id] = []
  byKw[x.keyword_id].push(x)
}
const dup = Object.entries(byKw).filter(([,v])=>v.length > 1)
console.log(`중복(같은 키워드에 여러 row): ${dup.length}개`)
if (dup.length > 0) {
  console.log('샘플:')
  for (const [id, arr] of dup.slice(0,5)) {
    console.log(`  ${kwMap.get(id) || id}: ${arr.length}건 - ranks=${arr.map(a=>a.rank_position).join(',')}`)
  }
}
console.log('')

// 4) 가장 최신 row만 (keyword_id별 dedup)
const latest = new Map()
for (const x of r) {
  if (!latest.has(x.keyword_id)) latest.set(x.keyword_id, x)
}
console.log(`unique 키워드 수: ${latest.size}`)

// 5) KPI 구간 카운트
let top10=0, mid=0, low=0, notFound=0
for (const x of latest.values()) {
  const p = x.rank_position
  if (p >= 1 && p <= 10) top10++
  else if (p >= 11 && p <= 27) mid++
  else if (p >= 28 && p <= 54) low++
  else notFound++
}
console.log(`\n--- unique 기준 (정상 KPI여야 할 값) ---`)
console.log(`  1~10위: ${top10}`)
console.log(`  11~27위: ${mid}`)
console.log(`  28~54위: ${low}`)
console.log(`  55+ / 못 찾음: ${notFound}`)

// 6) 다른 날짜별 카운트 — 화면의 13/12/4와 어느 날짜가 매치되는지
console.log('\n--- 날짜별 KPI 비교 (1~10 / 11~27 / 28~54) ---')
const dates = ['2026-05-20','2026-05-21','2026-05-22','2026-05-23','2026-05-24','2026-05-25','2026-05-26','2026-05-27']
for (const d of dates) {
  const dr = await (await fetch(`${URL}/rest/v1/keyword_rankings?select=keyword_id,rank_position&date=eq.${d}&limit=5000`, { headers: H })).json()
  if (!Array.isArray(dr) || dr.length === 0) {
    console.log(`  ${d}: (데이터 없음)`)
    continue
  }
  // unique
  const seen = new Map()
  for (const x of dr) if (!seen.has(x.keyword_id)) seen.set(x.keyword_id, x)
  let a=0,b=0,c=0,nf=0
  for (const x of seen.values()) {
    const p = x.rank_position
    if (p >= 1 && p <= 10) a++
    else if (p >= 11 && p <= 27) b++
    else if (p >= 28 && p <= 54) c++
    else nf++
  }
  console.log(`  ${d}: 1~10=${a} / 11~27=${b} / 28~54=${c} / 못찾음=${nf} (총 ${seen.size})`)
}

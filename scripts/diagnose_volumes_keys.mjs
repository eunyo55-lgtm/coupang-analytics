// 5/15~5/20 데이터의 keyword 값과 keywords 테이블 매칭 확인
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

// 1) keywords 테이블의 등록 키워드
const kwRes = await fetch(`${URL}/rest/v1/keywords?select=keyword`, { headers: H })
const tracked = new Set((await kwRes.json()).map(k => k.keyword))
console.log(`등록 키워드: ${tracked.size}개`)
console.log(`  예시: ${Array.from(tracked).slice(0, 5).map(k => `"${k}"`).join(', ')}`)
console.log('')

// 2) 5/15~5/20 keyword_search_volumes 의 keyword 값들
const r = await fetch(`${URL}/rest/v1/keyword_search_volumes?select=keyword&target_date=gte.2026-05-15&target_date=lte.2026-05-20&limit=10000`, { headers: H })
const recent = await r.json()
const recentKws = new Set(recent.map(x => x.keyword))
console.log(`5/15~5/20 검색량 데이터의 unique 키워드: ${recentKws.size}개 (총 row ${recent.length})`)
console.log(`  예시: ${Array.from(recentKws).slice(0, 10).map(k => `"${k}"`).join(', ')}`)
console.log('')

// 3) 교집합 / 차집합
const inTrackedNotInRecent = Array.from(tracked).filter(k => !recentKws.has(k))
const inRecentNotInTracked = Array.from(recentKws).filter(k => !tracked.has(k))
const both = Array.from(tracked).filter(k => recentKws.has(k))
console.log(`교집합 (양쪽 다 있음): ${both.length}개`)
console.log(`등록만 (검색량 데이터에 없음): ${inTrackedNotInRecent.length}개`)
console.log(`  ${inTrackedNotInRecent.slice(0, 10).map(k => `"${k}"`).join(', ')}`)
console.log(`검색량만 (등록 안 됨): ${inRecentNotInTracked.length}개`)
console.log(`  ${inRecentNotInTracked.slice(0, 10).map(k => `"${k}"`).join(', ')}`)
console.log('')

// 4) 차이가 공백 등 invisible char 차이인지
console.log('--- 공백/대소문자 정규화 비교 ---')
const norm = s => s.normalize('NFC').trim().toLowerCase()
const trackedNorm = new Set(Array.from(tracked).map(norm))
const matchAfterNorm = Array.from(recentKws).filter(k => trackedNorm.has(norm(k)))
console.log(`정규화 후 매칭: ${matchAfterNorm.length}개`)

// 5) 한 키워드 (예: 첫 inTrackedNotInRecent) bytes 분석
if (inTrackedNotInRecent.length > 0) {
  const sample = inTrackedNotInRecent[0]
  console.log(`\n샘플 등록 키워드 "${sample}":`)
  console.log(`  length: ${sample.length}, bytes: ${[...sample].map(c => c.charCodeAt(0).toString(16)).join(' ')}`)
  // 검색량 쪽에 비슷한 게 있는지
  const similar = Array.from(recentKws).find(k => k.includes(sample) || sample.includes(k))
  if (similar && similar !== sample) {
    console.log(`  유사: "${similar}" (length ${similar.length}, bytes: ${[...similar].map(c => c.charCodeAt(0).toString(16)).join(' ')})`)
  }
}

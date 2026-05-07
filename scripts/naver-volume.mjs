// Naver 검색량 봇
// 매일 1회 실행 — keywords 테이블의 모든 키워드에 대해 Naver Keywords API 호출
// 결과를 keyword_search_volumes 테이블에 저장 (target_date = 오늘)

import crypto from 'node:crypto'
import { selectAll, upsertRows } from './lib/supabase.mjs'

const NAVER_API = 'https://api.naver.com/keywordstool'
const CUSTOMER_ID = process.env.NAVER_CUSTOMER_ID
const ACCESS_LICENSE = process.env.NAVER_ACCESS_LICENSE
const SECRET_KEY = process.env.NAVER_SECRET_KEY

if (!CUSTOMER_ID || !ACCESS_LICENSE || !SECRET_KEY) {
  console.error('[naver] Missing NAVER_CUSTOMER_ID / NAVER_ACCESS_LICENSE / NAVER_SECRET_KEY')
  process.exit(1)
}

function makeSignature(timestamp, method, uri) {
  const message = `${timestamp}.${method}.${uri}`
  return crypto.createHmac('sha256', SECRET_KEY).update(message).digest('base64')
}

function getKSTDate() {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

async function fetchNaverVolumes(keywords) {
  // Naver API는 한 번에 hintKeywords 최대 5개까지 권장. 5개씩 끊어 호출.
  const results = []
  for (let i = 0; i < keywords.length; i += 5) {
    const batch = keywords.slice(i, i + 5)
    const timestamp = Date.now().toString()
    const uri = '/keywordstool'
    const signature = makeSignature(timestamp, 'GET', uri)

    const params = new URLSearchParams({
      hintKeywords: batch.join(','),
      showDetail: '1',
    })

    const res = await fetch(`${NAVER_API}?${params}`, {
      headers: {
        'X-Timestamp': timestamp,
        'X-API-KEY': ACCESS_LICENSE,
        'X-Customer': CUSTOMER_ID,
        'X-Signature': signature,
      },
    })

    if (!res.ok) {
      console.warn(`[naver] batch ${i / 5 + 1} failed: ${res.status}`)
      continue
    }

    const json = await res.json()
    const list = json.keywordList || []

    // Naver는 "hint와 관련된" 키워드까지 함께 반환하므로
    // 우리가 요청한 정확한 키워드와 매칭되는 것만 골라냄
    for (const requested of batch) {
      const match = list.find(item => String(item.relKeyword).trim() === requested.trim())
      if (!match) {
        console.warn(`[naver] no match for "${requested}"`)
        continue
      }
      const pc = Number(match.monthlyPcQcCnt) || 0
      const mobile = Number(match.monthlyMobileQcCnt) || 0
      results.push({ keyword: requested, pc_volume: pc, mobile_volume: mobile, total_volume: pc + mobile })
    }

    // Naver API 부하 방지 — 200ms 간격
    await new Promise(r => setTimeout(r, 200))
  }
  return results
}

async function main() {
  console.log(`[naver] start ${new Date().toISOString()}`)

  // keywords 테이블에서 활성 키워드 모두 조회
  const keywords = await selectAll('keywords', 'select=keyword&keyword=not.is.null')
  const uniqueKeywords = Array.from(new Set(keywords.map(k => k.keyword.trim()).filter(Boolean)))
  console.log(`[naver] unique keywords: ${uniqueKeywords.length}`)

  if (!uniqueKeywords.length) {
    console.log('[naver] no keywords — done')
    return
  }

  const targetDate = getKSTDate()
  const volumes = await fetchNaverVolumes(uniqueKeywords)
  console.log(`[naver] fetched volumes: ${volumes.length}/${uniqueKeywords.length}`)

  if (!volumes.length) {
    console.log('[naver] no volumes fetched — done')
    return
  }

  const rows = volumes.map(v => ({
    keyword: v.keyword,
    target_date: targetDate,
    pc_volume: v.pc_volume,
    mobile_volume: v.mobile_volume,
    total_volume: v.total_volume,
  }))

  // (keyword, target_date) unique constraint 가정 — 없으면 upsertRows가 실패하므로
  // 그 경우 단순 insert로 fallback
  try {
    await upsertRows('keyword_search_volumes', rows, 'keyword,target_date')
    console.log(`[naver] upserted ${rows.length} rows`)
  } catch (e) {
    console.warn('[naver] upsert failed, fallback to insert:', e.message)
    const { insertRows } = await import('./lib/supabase.mjs')
    await insertRows('keyword_search_volumes', rows)
    console.log(`[naver] inserted ${rows.length} rows`)
  }

  console.log(`[naver] done ${new Date().toISOString()}`)
}

main().catch(e => {
  console.error('[naver] fatal:', e)
  process.exit(1)
})

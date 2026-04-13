import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// Naver Search Advisor API
// Docs: https://searchadvisor.naver.com/guide/api-get-request
const API_URL = 'https://api.naver.com/keywordstool'

function makeSignature(timestamp: string, method: string, uri: string, secretKey: string): string {
  const message = `${timestamp}.${method}.${uri}`
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64')
}

export async function POST(req: NextRequest) {
  const { keywords } = await req.json()

  if (!keywords?.length) {
    return NextResponse.json({ error: '키워드를 입력하세요' }, { status: 400 })
  }

  const customerId = process.env.NAVER_CUSTOMER_ID
  const accessLicense = process.env.NAVER_ACCESS_LICENSE
  const secretKey = process.env.NAVER_SECRET_KEY

  // If no API keys configured, return realistic demo data
  if (!customerId || !accessLicense || !secretKey) {
    const demo = keywords.map((kw: string) => {
      const pc     = Math.floor(Math.random() * 50000 + 1000)
      const mobile = Math.floor(Math.random() * 150000 + 5000)
      const total  = pc + mobile
      return {
        keyword: kw,
        pc,
        mobile,
        total,
        competition: total > 100000 ? 'high' : total > 30000 ? 'mid' : 'low',
      }
    })
    return NextResponse.json({ results: demo, demo: true })
  }

  try {
    const timestamp = Date.now().toString()
    const uri = '/keywordstool'
    const signature = makeSignature(timestamp, 'GET', uri, secretKey)

    const params = new URLSearchParams({
      hintKeywords: keywords.join(','),
      showDetail: '1',
    })

    const res = await fetch(`${API_URL}?${params}`, {
      headers: {
        'X-Timestamp':      timestamp,
        'X-API-KEY':        accessLicense,
        'X-Customer':       customerId,
        'X-Signature':      signature,
        'Content-Type':     'application/json',
      },
    })

    if (!res.ok) {
      throw new Error(`Naver API error: ${res.status}`)
    }

    const json = await res.json()

    // Normalize Naver API response
    const results = (json.keywordList || []).map((item: Record<string, unknown>) => {
      const pc     = Number(item.monthlyPcQcCnt)     || 0
      const mobile = Number(item.monthlyMobileQcCnt) || 0
      const total  = pc + mobile
      return {
        keyword:     item.relKeyword as string,
        pc,
        mobile,
        total,
        competition: total > 100000 ? 'high' : total > 30000 ? 'mid' : 'low',
      }
    })

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'API 오류' },
      { status: 500 }
    )
  }
}

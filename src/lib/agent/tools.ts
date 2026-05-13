import { FunctionDeclaration, Type } from '@google/genai'
import { getServerSupabase } from './supabase-server'
import crypto from 'crypto'

// Gemini의 function declarations (OpenAPI 3 subset).
// description은 모델이 "언제 이 도구를 쓰는가"를 판단하는 핵심 단서이므로 명확하게.

const ymdField = {
  type: Type.STRING,
  description: 'YYYY-MM-DD 형식 일자 (예: 2026-05-12)',
}

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'get_kpi_by_date',
    description: '특정 일자 하루의 판매 수량(total_qty)과 매출액(total_revenue)을 반환합니다.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        target_date: { ...ymdField, description: '조회할 일자' },
      },
      required: ['target_date'],
    },
  },
  {
    name: 'get_kpi_range',
    description:
      '지정 기간(date_from~date_to)의 총 판매 수량과 매출액 합계를 반환합니다. ' +
      '일별·주간·월간·누적 합계 분석에 사용합니다. 결과: { total_qty, total_revenue }',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date_from: { ...ymdField, description: '시작일 (포함)' },
        date_to:   { ...ymdField, description: '종료일 (포함)' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'get_top_products',
    description:
      '기간 내 가장 많이 팔린 상품 TOP N을 반환합니다. ' +
      '베스트셀러, 판매 1위, 매출 상위 등 질문에 사용. ' +
      '결과: [{ product_name, image_url, total_qty, total_revenue }]',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date_from: ymdField,
        date_to:   ymdField,
        top_n: {
          type: Type.INTEGER,
          description: '가져올 상품 수 (기본 10, 최대 50)',
        },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'get_top_stock',
    description:
      '현재 쿠팡 재고가 많은 상품 TOP N을 반환합니다. ' +
      '재고 회전 분석, 발주 우선순위 판단에 사용.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        top_n: {
          type: Type.INTEGER,
          description: '가져올 상품 수 (기본 10, 최대 50)',
        },
      },
      required: ['top_n'],
    },
  },
  {
    name: 'get_daily_qty_by_year',
    description:
      '특정 연도의 일자별 판매 수량을 전부 반환합니다. ' +
      '연도 비교, 추이 분석에 사용. 결과: [{ sale_date, total_qty }]',
    parameters: {
      type: Type.OBJECT,
      properties: {
        target_year: {
          type: Type.INTEGER,
          description: '조회할 연도 (예: 2026)',
        },
      },
      required: ['target_year'],
    },
  },
  {
    name: 'get_stock_summary',
    description: '전체 재고 요약(총 재고량 total_stock, 재고 평가액 stock_value)을 반환합니다.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  // ── 키워드 발굴 (AI 어시스턴트가 신규 키워드 추천 시 사용) ──
  {
    name: 'list_tracked_keywords',
    description:
      '현재 시스템에 추적 중인 키워드 목록을 반환합니다. ' +
      '신규 키워드 추천 시 "이미 등록된 것은 제외"하기 위해 먼저 호출하세요. ' +
      '결과: [{ keyword, category, type }]',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'list_keyword_volumes_recent',
    description:
      '최근 14일간 키워드별 평균 검색량과 변동률을 반환합니다. ' +
      '"상승 중인 키워드", "어떤 키워드가 잘 나가나" 같은 질문에 사용. ' +
      '결과: [{ keyword, recent_7d_avg, prev_7d_avg, change_pct }] · 변동률 desc 정렬, 상위 30개',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'expand_keywords_via_naver',
    description:
      '시드 키워드 1~5개를 네이버 검색광고 API로 보내 연관 키워드 + 월간 PC/모바일 검색량을 가져옵니다. ' +
      '"이 카테고리의 키워드 발굴", "신상품 출시 키워드 추천", "경쟁/대체 키워드 탐색" 시 사용. ' +
      '결과: [{ keyword, monthly_pc_volume, monthly_mobile_volume, total_volume }] · total_volume desc 정렬',
    parameters: {
      type: Type.OBJECT,
      properties: {
        seeds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '시드 키워드 배열 (1-5개, 예: ["아동 우비", "키즈 레인부츠"])',
        },
        limit: {
          type: Type.INTEGER,
          description: '반환할 최대 키워드 개수 (기본 30, 최대 50)',
        },
      },
      required: ['seeds'],
    },
  },
]

// ── 네이버 검색광고 API 헬퍼 (server-side only) ──
function parseNaverVolume(val: unknown): number {
  const s = String(val ?? '0').trim()
  if (s.includes('< 10')) return 5
  const n = parseInt(s.replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

async function fetchNaverKeywordList(seeds: string[]): Promise<Array<{
  relKeyword: string
  monthlyPcQcCnt: unknown
  monthlyMobileQcCnt: unknown
}>> {
  const customerId = process.env.NAVER_CUSTOMER_ID
  const accessLicense = process.env.NAVER_ACCESS_LICENSE
  const secretKey = process.env.NAVER_SECRET_KEY
  if (!customerId || !accessLicense || !secretKey) {
    throw new Error('Naver API credentials missing (NAVER_CUSTOMER_ID / NAVER_ACCESS_LICENSE / NAVER_SECRET_KEY)')
  }
  const apiPath = '/keywordstool'
  const method = 'GET'
  const timestamp = Date.now().toString()
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${timestamp}.${method}.${apiPath}`)
    .digest('base64')
  const url = new URL(`https://api.naver.com${apiPath}`)
  url.searchParams.append('hintKeywords', seeds.join(','))
  url.searchParams.append('showDetail', '1')
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-Timestamp': timestamp,
      'X-API-KEY': accessLicense,
      'X-Customer': customerId,
      'X-Signature': signature,
    },
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Naver API ${res.status}: ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  return data?.keywordList ?? []
}

// 도구명 → 실제 실행 함수 (server-side에서 Supabase RPC 호출).
type Args = Record<string, unknown>

export async function executeTool(name: string, args: Args): Promise<unknown> {
  const supa = getServerSupabase()
  try {
    switch (name) {
      case 'get_kpi_by_date': {
        const { data, error } = await supa.rpc('get_kpi_by_date', { target_date: String(args.target_date) })
        if (error) return { error: error.message }
        return data?.[0] ?? { total_qty: 0, total_revenue: 0 }
      }
      case 'get_kpi_range': {
        const { data, error } = await supa.rpc('get_kpi_range', {
          date_from: String(args.date_from),
          date_to:   String(args.date_to),
        })
        if (error) return { error: error.message }
        return data?.[0] ?? { total_qty: 0, total_revenue: 0 }
      }
      case 'get_top_products': {
        const top_n = Math.min(50, Math.max(1, Number(args.top_n ?? 10)))
        const { data, error } = await supa.rpc('get_top_products', {
          date_from: String(args.date_from),
          date_to:   String(args.date_to),
          top_n,
        })
        if (error) return { error: error.message }
        return data ?? []
      }
      case 'get_top_stock': {
        const top_n = Math.min(50, Math.max(1, Number(args.top_n ?? 10)))
        const { data, error } = await supa.rpc('get_top_stock', { top_n })
        if (error) return { error: error.message }
        return data ?? []
      }
      case 'get_daily_qty_by_year': {
        const target_year = Number(args.target_year)
        const { data, error } = await supa.rpc('get_daily_qty_by_year', { target_year })
        if (error) return { error: error.message }
        return data ?? []
      }
      case 'get_stock_summary': {
        const { data, error } = await supa.rpc('get_stock_summary')
        if (error) return { error: error.message }
        return data?.[0] ?? null
      }
      case 'list_tracked_keywords': {
        const { data, error } = await supa
          .from('keywords')
          .select('keyword, category, type')
        if (error) return { error: error.message }
        // 중복 제거 (같은 키워드가 여러 type으로 등록된 경우)
        const seen = new Map<string, { keyword: string; category: string | null; type: string | null }>()
        for (const r of (data ?? [])) {
          if (!seen.has(r.keyword)) seen.set(r.keyword, r)
        }
        return Array.from(seen.values())
      }
      case 'list_keyword_volumes_recent': {
        // 최근 14일 검색량 → 7일 평균 vs 이전 7일 평균 + 변동률
        const since = new Date(Date.now() + 9 * 3600_000 - 14 * 86400_000).toISOString().slice(0, 10)
        const { data, error } = await supa
          .from('keyword_search_volumes')
          .select('keyword, target_date, total_volume')
          .gte('target_date', since)
        if (error) return { error: error.message }
        const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
        const cutoff = new Date(Date.now() + 9 * 3600_000 - 7 * 86400_000).toISOString().slice(0, 10)
        const acc: Record<string, { recent: number[]; prev: number[] }> = {}
        for (const r of (data ?? [])) {
          if (!acc[r.keyword]) acc[r.keyword] = { recent: [], prev: [] }
          const v = Number(r.total_volume ?? 0)
          if (r.target_date >= cutoff && r.target_date <= today) acc[r.keyword].recent.push(v)
          else acc[r.keyword].prev.push(v)
        }
        const avg = (a: number[]) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0
        const out = Object.entries(acc).map(([k, v]) => {
          const r = avg(v.recent), p = avg(v.prev)
          const pct = p > 0 ? Math.round((r - p) / p * 1000) / 10 : (r > 0 ? 100 : 0)
          return { keyword: k, recent_7d_avg: r, prev_7d_avg: p, change_pct: pct }
        })
        out.sort((a, b) => b.change_pct - a.change_pct)
        return out.slice(0, 30)
      }
      case 'expand_keywords_via_naver': {
        const seeds = (Array.isArray(args.seeds) ? args.seeds as string[] : [])
          .map(s => String(s).trim()).filter(Boolean).slice(0, 5)
        const limit = Math.min(50, Math.max(5, Number(args.limit ?? 30)))
        if (seeds.length === 0) return { error: 'seeds 배열에 최소 1개 키워드가 필요합니다' }
        try {
          const list = await fetchNaverKeywordList(seeds)
          const mapped = list.map(r => {
            const pc = parseNaverVolume(r.monthlyPcQcCnt)
            const mb = parseNaverVolume(r.monthlyMobileQcCnt)
            return {
              keyword: r.relKeyword,
              monthly_pc_volume: pc,
              monthly_mobile_volume: mb,
              total_volume: pc + mb,
            }
          })
          mapped.sort((a, b) => b.total_volume - a.total_volume)
          return mapped.slice(0, limit)
        } catch (e: any) {
          return { error: e?.message ?? String(e) }
        }
      }
      default:
        return { error: `Unknown tool: ${name}` }
    }
  } catch (e: any) {
    return { error: e?.message ?? String(e) }
  }
}

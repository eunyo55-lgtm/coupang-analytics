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
  {
    name: 'register_keyword',
    description:
      '신규 키워드를 추적 대상으로 등록합니다. 사용자가 "X 등록해줘", "Y 추가해줘", "이 키워드들 등록" 등의 명령을 줄 때 사용. ' +
      '필수: keyword(키워드 텍스트), coupang_product_id(쿠팡 Wing/와이드에서 확인한 상품 ID — 10자리 숫자). ' +
      'type은 미지정 시 기존 키워드 중 가장 많이 쓰인 type을 자동 적용. ' +
      '같은 keyword + coupang_product_id 조합은 중복 등록되지 않음. ' +
      '등록 즉시 다음 봇 사이클(매일 KST 09:05)부터 자동 추적 시작.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        keyword: { type: Type.STRING, description: '키워드 텍스트 (예: "아기신발", "걸음마신발")' },
        coupang_product_id: { type: Type.STRING, description: '쿠팡 상품 ID — 보통 10자리 숫자 (예: "1234567890")' },
        category: { type: Type.STRING, description: '카테고리 (선택, 예: "신발", "의류")' },
        type: { type: Type.STRING, description: '키워드 유형 (선택, 미지정 시 자동 추정)' },
        barcode: { type: Type.STRING, description: '바코드 (선택)' },
      },
      required: ['keyword', 'coupang_product_id'],
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
        // 디버그용 환경변수 존재 점검 (값은 노출하지 않음, 존재 여부와 길이만)
        const envProbe = {
          has_customer_id: !!process.env.NAVER_CUSTOMER_ID,
          customer_id_len: (process.env.NAVER_CUSTOMER_ID || '').length,
          has_access_license: !!process.env.NAVER_ACCESS_LICENSE,
          access_license_len: (process.env.NAVER_ACCESS_LICENSE || '').length,
          has_secret_key: !!process.env.NAVER_SECRET_KEY,
          secret_key_len: (process.env.NAVER_SECRET_KEY || '').length,
        }
        try {
          const list = await fetchNaverKeywordList(seeds)
          console.log('[expand_keywords_via_naver] naver returned', list.length, 'items for seeds:', seeds)
          if (list.length === 0) {
            // API 자체는 성공했지만 연관 키워드가 0개인 경우 (시드가 너무 좁거나, 등록되지 않은 키워드)
            return {
              status: 'empty_result',
              message: `네이버 API 호출은 성공했지만 시드 [${seeds.join(', ')}]에 대해 연관 키워드가 0개입니다. 시드를 더 일반적/대중적으로 바꾸거나 (예: '샌들' → '아동샌들', '여성샌들') 다른 키워드로 시도해 보세요.`,
              seeds_used: seeds,
              naver_returned: 0,
              debug_env: envProbe,
            }
          }
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
          return {
            status: 'success',
            seeds_used: seeds,
            results: mapped.slice(0, limit),
            total_returned_by_naver: list.length,
          }
        } catch (e: any) {
          const msg = e?.message ?? String(e)
          console.error('[expand_keywords_via_naver] throw 발생:', msg, envProbe)
          return {
            status: 'error',
            error: msg,
            user_facing_help:
              `네이버 API 호출 실패. 환경변수 점검: ` +
              `CUSTOMER_ID=${envProbe.has_customer_id ? `있음(${envProbe.customer_id_len}자)` : '❌없음'}, ` +
              `ACCESS_LICENSE=${envProbe.has_access_license ? `있음(${envProbe.access_license_len}자)` : '❌없음'}, ` +
              `SECRET_KEY=${envProbe.has_secret_key ? `있음(${envProbe.secret_key_len}자)` : '❌없음'}. ` +
              `원본 에러: ${msg.slice(0, 200)}`,
            debug_env: envProbe,
          }
        }
      }
      case 'register_keyword': {
        const keyword = String(args.keyword ?? '').trim()
        const coupang_product_id = String(args.coupang_product_id ?? '').trim()
        if (!keyword || !coupang_product_id) {
          return {
            status: 'error',
            error: 'keyword와 coupang_product_id가 모두 필요합니다',
          }
        }
        const category = args.category ? String(args.category).trim() || null : null
        const barcode = args.barcode ? String(args.barcode).trim() || null : null
        let type = args.type ? String(args.type).trim() : ''

        // type 미지정 시 기존 키워드의 가장 빈도 높은 type 자동 사용
        if (!type) {
          const { data: typeData } = await supa.from('keywords').select('type').limit(500)
          const counts: Record<string, number> = {}
          for (const r of typeData ?? []) {
            if (r.type) counts[r.type] = (counts[r.type] || 0) + 1
          }
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
          type = top?.[0] ?? 'main'
        }

        // 중복 체크
        const { data: existing } = await supa
          .from('keywords')
          .select('id')
          .eq('keyword', keyword)
          .eq('coupang_product_id', coupang_product_id)
          .limit(1)
        if (existing && existing.length > 0) {
          return {
            status: 'duplicate',
            message: `이미 등록된 키워드입니다: "${keyword}" (상품 ID: ${coupang_product_id})`,
            existing_id: existing[0].id,
          }
        }

        // INSERT
        const { data: inserted, error } = await supa
          .from('keywords')
          .insert({ keyword, coupang_product_id, type, category, barcode })
          .select('id, keyword, coupang_product_id, type, category')
          .single()
        if (error) {
          return {
            status: 'error',
            error: error.message,
            attempted: { keyword, coupang_product_id, type, category, barcode },
          }
        }
        return {
          status: 'success',
          message: `✅ "${keyword}" 등록 완료 (쿠팡 상품 ID: ${coupang_product_id}, type: ${type}${category ? `, category: ${category}` : ''}). 다음 봇 사이클(매일 KST 09:05)부터 자동 추적됩니다.`,
          registered: inserted,
        }
      }
      default:
        return { error: `Unknown tool: ${name}` }
    }
  } catch (e: any) {
    return { error: e?.message ?? String(e) }
  }
}

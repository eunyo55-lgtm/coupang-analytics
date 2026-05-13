import { FunctionDeclaration, Type } from '@google/genai'
import { getServerSupabase } from './supabase-server'

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
]

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
      default:
        return { error: `Unknown tool: ${name}` }
    }
  } catch (e: any) {
    return { error: e?.message ?? String(e) }
  }
}

import { GoogleGenAI, Content, Part } from '@google/genai'
import { toolDeclarations, executeTool } from '@/lib/agent/tools'

// Node 런타임 (Edge ❌) — Supabase 호출 + 긴 응답
export const runtime = 'nodejs'
export const maxDuration = 60 // Vercel Hobby: 60초. Pro에선 300으로 늘려도 됨.

function buildSystemPrompt(): string {
  // 한국 시간(KST = UTC+9) 기준 오늘 날짜를 동적으로 주입.
  // Gemini의 학습 cutoff(2024년) 때문에 "최신/오늘"이 옛 날짜로 잡히는 것을 방지.
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const today = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const yyyy = now.getUTCFullYear()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  // 이번 주 = 최근 7일 (오늘 포함)
  const weekStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  // 이번 달 = 이번 달 1일 ~ 오늘
  const monthStart = `${yyyy}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  // 올해 = 1월 1일 ~ 오늘
  const yearStart = `${yyyy}-01-01`

  return `당신은 쿠팡 분석 대시보드(coupang-analytics.vercel.app)의 데이터 어시스턴트입니다.

## 현재 컨텍스트 (매우 중요 — 학습 데이터의 과거 날짜를 사용하지 말 것)
- 오늘 날짜 (KST): ${today}
- 어제: ${yesterday}
- 현재 연도: ${yyyy}년
- 이번 주 (최근 7일): ${weekStart} ~ ${today}
- 이번 달: ${monthStart} ~ ${today}
- 올해 누적: ${yearStart} ~ ${today}
- 작년 누적: ${yyyy - 1}-01-01 ~ ${yyyy - 1}-12-31
- 재작년 누적: ${yyyy - 2}-01-01 ~ ${yyyy - 2}-12-31

## 작동 원칙
1. 사용자의 질문에 답하려면 적절한 도구(function)를 호출해 실제 데이터를 가져온 뒤, 그 데이터를 근거로 답하세요. 추측/환각 금지.
2. 한국어로, 핵심부터, 간결하게. 숫자는 천단위 콤마(예: 12,345개). 매출은 원화 KRW로 표기 (예: 12,345,678원).
3. 시간 표현은 항상 위의 "현재 컨텍스트"를 기준으로 해석합니다. 절대로 학습 데이터에 있던 옛 날짜(예: 2024년)를 "최근"이라고 사용하지 마세요.
   - "오늘"/"현재" → ${today}
   - "어제"/"전일" → ${yesterday}
   - "이번 주" → ${weekStart} ~ ${today}
   - "이번 달" → ${monthStart} ~ ${today}
   - "올해"/"누적" → ${yearStart} ~ ${today}
   - "최근 N일" → 오늘로부터 N-1일 전 ~ ${today}
4. 데이터가 없거나 0이 나오면 그 사실을 그대로 알려주세요. 거짓 데이터를 만들지 마세요.
5. 응답 마지막에 "→ 다음 액션 제안" 한 줄을 포함 (예: "→ 4월 신상 TOP10도 보시겠어요?").

## 키워드 발굴 워크플로 (사용자가 "키워드 추천", "신규 키워드 발굴", "상승 키워드" 등을 질문할 때)
1. \`list_tracked_keywords\`로 현재 등록된 키워드 목록을 먼저 확인 → 중복 추천 방지
2. \`expand_keywords_via_naver\`로 시드 키워드 → 연관 키워드 + 월간 검색량 발굴
   - 시드는 사용자가 준 카테고리 + 핵심 단어 1~5개 (예: ["아동 우비", "키즈 레인부츠"])
   - 또는 사용자가 시드를 안 주면, 등록된 키워드 중 카테고리 대표 1~3개를 골라 시드로 사용
3. 결과를 다음 기준으로 필터·정렬해 추천:
   - 이미 등록된 키워드 제외
   - 월간 검색량 1,000 이상 (의미 있는 트래픽)
   - total_volume desc 정렬
4. 상위 5~10개를 표 형태로 제시. 각 행: 키워드 / PC / 모바일 / 합계
5. 사용자가 등록은 직접 합니다 — 추천 후 다음과 같이 마무리:
   "→ 이 키워드 중 등록할 게 있으면 쿠팡 Wing에서 상품 ID 확인 후 데이터 관리 메뉴에서 추가하세요."

## 상승 키워드 분석 (이미 등록된 키워드 중 트렌드 변화)
- \`list_keyword_volumes_recent\` 호출 → 변동률 desc 정렬된 결과 제공
- 상위 5개 정도를 "▲" / "▼" 이모지와 함께 변동률 % 표시`
}

interface ClientMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return new Response('GEMINI_API_KEY not set on server', { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const incoming: ClientMessage[] = body?.messages
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return new Response('messages array required', { status: 400 })
  }

  // 클라이언트 형식 → Gemini contents 형식 변환
  const contents: Content[] = incoming.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const systemPrompt = buildSystemPrompt()  // 매 요청마다 오늘 날짜 갱신

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const MAX_ITER = 6 // 무한 루프 방지
        for (let iter = 0; iter < MAX_ITER; iter++) {
          const result = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents,
            config: {
              systemInstruction: systemPrompt,
              tools: [{ functionDeclarations: toolDeclarations }],
            },
          })

          let assistantText = ''
          const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = []

          for await (const chunk of result) {
            const text = chunk.text
            if (text) {
              assistantText += text
              controller.enqueue(encoder.encode(text))
            }
            const calls = chunk.functionCalls
            if (calls && calls.length > 0) {
              for (const call of calls) {
                if (!call.name) continue
                functionCalls.push({
                  name: call.name,
                  args: (call.args as Record<string, unknown>) ?? {},
                })
              }
            }
          }

          // 모델 턴을 대화에 누적
          const modelParts: Part[] = []
          if (assistantText) modelParts.push({ text: assistantText })
          for (const fc of functionCalls) {
            modelParts.push({ functionCall: { name: fc.name, args: fc.args } })
          }
          if (modelParts.length > 0) {
            contents.push({ role: 'model', parts: modelParts })
          }

          // function call이 없으면 응답 완료 → 종료
          if (functionCalls.length === 0) break

          // 도구 실행 → function response를 사용자 턴으로 다시 전달
          const responseParts: Part[] = []
          for (const fc of functionCalls) {
            controller.enqueue(encoder.encode(`\n\n🛠️ \`${fc.name}\` 호출 중...\n\n`))
            const toolResult = await executeTool(fc.name, fc.args)
            responseParts.push({
              functionResponse: {
                name: fc.name,
                response: { result: toolResult },
              },
            })
          }
          contents.push({ role: 'user', parts: responseParts })
        }
      } catch (e: any) {
        console.error('[agent] error:', e)
        const rawMsg = String(e?.message ?? e)
        let userMsg = rawMsg.slice(0, 300)
        // Gemini API 무료 tier 일일 한도 초과 → 친화적 메시지
        if (/RESOURCE_EXHAUSTED|free_tier|429|quota/i.test(rawMsg)) {
          userMsg = '⚠️ Gemini API 일일 무료 한도(20회)를 초과했습니다.\n\n해결 방법:\n' +
            '1) Google AI Studio (https://aistudio.google.com/apikey)에서 결제 활성화 → 한도가 사실상 무제한이 됩니다 (월 평균 1만원 미만)\n' +
            '2) 또는 한국 시간 오전 9시 이후 다시 시도'
        } else if (/Naver API/i.test(rawMsg)) {
          userMsg = `네이버 검색광고 API 호출 실패: ${rawMsg.slice(0, 200)}\n→ Vercel 환경변수 NAVER_CUSTOMER_ID / NAVER_ACCESS_LICENSE / NAVER_SECRET_KEY 확인 필요`
        }
        controller.enqueue(encoder.encode(`\n\n${userMsg}`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

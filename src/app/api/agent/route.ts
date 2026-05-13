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
5. 응답 마지막에 "→ 다음 액션 제안" 한 줄을 포함 (예: "→ 4월 신상 TOP10도 보시겠어요?").`
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
        controller.enqueue(encoder.encode(`\n\n[오류: ${e?.message ?? e}]`))
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

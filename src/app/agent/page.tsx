'use client'
import { useRef, useState, FormEvent } from 'react'

type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  '어제 판매량과 매출 알려줘',
  '이번 주 TOP 10 상품 보여줘',
  '올해 누적 판매량은?',
  '재고가 가장 많은 상품 5개와 그 평가액',
  '4월 첫째 주 vs 4월 마지막 주 비교해줘',
]

export default function AgentPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || loading) return
    setInput('')
    const next: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setLoading(true)

    // 빈 어시스턴트 메시지를 먼저 추가하고 스트림으로 채워나감
    setMessages(curr => [...curr, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      if (!res.ok || !res.body) {
        const errTxt = await res.text().catch(() => '요청 실패')
        setMessages(curr => {
          const copy = [...curr]
          copy[copy.length - 1] = { role: 'assistant', content: `[오류] ${errTxt}` }
          return copy
        })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        setMessages(curr => {
          const copy = [...curr]
          copy[copy.length - 1] = { role: 'assistant', content: buf }
          return copy
        })
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    } finally {
      setLoading(false)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send()
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">📊 분석 어시스턴트</h1>
        <p className="text-sm text-slate-500 mt-1">
          판매·재고·추이를 자연어로 물어보세요. Claude가 Supabase 데이터를 직접 조회해 답합니다.
        </p>
      </header>

      {messages.length === 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">예시</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="px-3 py-1.5 text-sm rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4 mb-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[80%] bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5'
                  : 'max-w-[90%] bg-slate-100 text-slate-900 rounded-2xl rounded-bl-sm px-4 py-2.5 whitespace-pre-wrap'
              }
            >
              {m.content || (loading && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 sticky bottom-4 bg-white/80 backdrop-blur p-2 rounded-2xl shadow-md border border-slate-200">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
          placeholder={loading ? '답변 생성 중…' : '판매·재고에 대해 물어보세요'}
          className="flex-1 px-3 py-2 outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl font-medium disabled:opacity-40"
        >
          전송
        </button>
      </form>
    </div>
  )
}

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
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 80px)' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>📊 AI 어시스턴트</h1>
        <p style={{ fontSize: 13, color: 'var(--t3, #64748b)', marginTop: 6 }}>
          판매·재고·추이를 자연어로 물어보세요. Gemini가 Supabase 데이터를 직접 조회해 답합니다.
        </p>
      </header>

      {messages.length === 0 && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3, #64748b)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>예시 질문</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                style={{ padding: '6px 12px', fontSize: 13, borderRadius: 999, background: '#f1f5f9', color: '#334155', border: 'none', cursor: 'pointer' }}
                onMouseOver={e => (e.currentTarget.style.background = '#e2e8f0')}
                onMouseOut={e => (e.currentTarget.style.background = '#f1f5f9')}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              style={{
                maxWidth: m.role === 'user' ? '80%' : '92%',
                background: m.role === 'user' ? '#2563eb' : '#f1f5f9',
                color: m.role === 'user' ? 'white' : '#0f172a',
                borderRadius: 16,
                borderBottomRightRadius: m.role === 'user' ? 4 : 16,
                borderBottomLeftRadius: m.role === 'user' ? 16 : 4,
                padding: '10px 16px',
                whiteSpace: m.role === 'assistant' ? 'pre-wrap' : 'normal',
                lineHeight: 1.5,
                fontSize: 14,
              }}
            >
              {m.content || (loading && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSubmit}
        style={{
          display: 'flex',
          gap: 8,
          position: 'sticky',
          bottom: 16,
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(8px)',
          padding: 8,
          borderRadius: 16,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          border: '1px solid #e2e8f0',
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
          placeholder={loading ? '답변 생성 중…' : '판매·재고에 대해 물어보세요'}
          style={{ flex: 1, padding: '10px 12px', outline: 'none', border: 'none', fontSize: 14, background: 'transparent' }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 18px',
            background: '#2563eb',
            color: 'white',
            borderRadius: 12,
            border: 'none',
            fontWeight: 600,
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !input.trim() ? 0.4 : 1,
            fontSize: 14,
          }}
        >
          전송
        </button>
      </form>
    </div>
  )
}

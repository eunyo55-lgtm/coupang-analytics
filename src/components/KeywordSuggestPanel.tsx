'use client'
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

type Suggestion = {
  keyword: string
  pc: number
  mobile: number
  total: number
  competition: 'high' | 'mid' | 'low' | string
  sourceSeed: string
}

type AvailableProduct = {
  barcode: string
  name: string
  coupang_product_id: string
}

type Props = {
  /** 시드 후보 — 기존 등록 키워드 / 카테고리 / 상품명 */
  existingKeywords: string[]
  categories: string[]
  productNames: string[]
  /** 등록 시 연결 가능한 상품 목록 (기존 키워드의 상품 매핑에서 추출) */
  availableProducts: AvailableProduct[]
  /** 등록 후 부모 새로고침 트리거 */
  onRegistered?: () => void
}

export default function KeywordSuggestPanel({
  existingKeywords, categories, productNames, availableProducts, onRegistered,
}: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'auto' | 'category' | 'manual'>('auto')
  const [selectedCat, setSelectedCat] = useState<string>('')
  const [manualSeeds, setManualSeeds] = useState('')
  const [useClaude, setUseClaude] = useState(true)
  const [kidsOnly, setKidsOnly] = useState(true)  // 키즈/유아/베이비 전용
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Suggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<{ seedCount: number; claudeUsed: boolean; adultFiltered: number } | null>(null)
  const [registering, setRegistering] = useState<Set<string>>(new Set())
  const [registered, setRegistered] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  // 키워드별 선택된 상품 barcode (드롭다운 상태)
  const [rowProduct, setRowProduct] = useState<Record<string, string>>({})
  // 일괄 적용용 기본 상품
  const [defaultProduct, setDefaultProduct] = useState<string>('')

  const seedPool = useMemo(() => {
    if (mode === 'manual') {
      return manualSeeds.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    }
    if (mode === 'category') {
      return selectedCat ? [selectedCat] : []
    }
    // auto: 대표 카테고리 + 인기 상품명 일부
    const cats = Array.from(new Set(categories)).filter(Boolean).slice(0, 8)
    const prods = Array.from(new Set(productNames))
      .filter(Boolean)
      .slice(0, 6)  // 너무 많지 않게
    return Array.from(new Set([...cats, ...prods]))
  }, [mode, manualSeeds, selectedCat, categories, productNames])

  async function runSuggest() {
    if (seedPool.length === 0) {
      setError('시드 키워드가 없습니다')
      return
    }
    setLoading(true)
    setError(null)
    setResults([])
    setInfo(null)
    try {
      const r = await fetch('/api/keyword-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seeds: seedPool,
          excludeKeywords: existingKeywords,
          useClaude,
          kidsOnly,
          maxResults: 80,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '실패')
      setResults(j.suggestions || [])
      setInfo({
        seedCount: j.seedCount || 0,
        claudeUsed: !!j.claudeUsed,
        adultFiltered: j.adultFiltered || 0,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '실패')
    } finally {
      setLoading(false)
    }
  }

  async function registerKeyword(s: Suggestion) {
    if (registered.has(s.keyword)) return
    // 행별 선택값 → 없으면 기본 상품 → 그것도 없으면 null
    const barcode = rowProduct[s.keyword] || defaultProduct || ''
    const linked  = barcode ? availableProducts.find(p => p.barcode === barcode) : null
    if (!linked) {
      alert('연결할 상품을 선택해주세요 (행 옆 드롭다운 또는 상단 기본 상품)')
      return
    }
    setRegistering(prev => new Set(prev).add(s.keyword))
    try {
      const { error } = await supabase.from('keywords').insert([{
        keyword: s.keyword,
        type: '추천',
        category: mode === 'category' ? selectedCat : null,
        coupang_product_id: linked.coupang_product_id,
        barcode: linked.barcode,
      }])
      if (error) throw error
      setRegistered(prev => new Set(prev).add(s.keyword))
      onRegistered?.()
    } catch (e) {
      alert(`등록 실패: ${e instanceof Error ? e.message : ''}`)
    } finally {
      setRegistering(prev => {
        const next = new Set(prev)
        next.delete(s.keyword)
        return next
      })
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return results
    const q = search.toLowerCase()
    return results.filter(r => r.keyword.toLowerCase().includes(q))
  }, [results, search])

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="ch" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div className="ch-l">
          <div className="ch-ico">🔍</div>
          <div>
            <div className="ch-title">키워드 발굴 제안 {open ? '▼' : '▶'}</div>
            <div className="ch-sub">상품·카테고리·기존 키워드에서 새 후보 발굴 (Claude + Naver)</div>
          </div>
        </div>
      </div>

      {open && (
        <div className="cb" style={{ padding: 14 }}>
          {/* 모드 선택 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {([
              { k: 'auto',     label: '🤖 자동 (카테고리+상품 혼합)' },
              { k: 'category', label: '📂 카테고리 선택' },
              { k: 'manual',   label: '✍️ 직접 입력' },
            ] as const).map(b => (
              <button
                key={b.k}
                onClick={() => setMode(b.k)}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  border: '1px solid ' + (mode === b.k ? '#1570EF' : '#E4E7EC'),
                  background: mode === b.k ? '#EFF6FF' : '#fff',
                  color: mode === b.k ? '#1570EF' : 'var(--t2)',
                  fontWeight: mode === b.k ? 700 : 500,
                  fontSize: 12, cursor: 'pointer',
                }}
              >{b.label}</button>
            ))}
          </div>

          {/* 카테고리 선택 모드 */}
          {mode === 'category' && (
            <div style={{ marginBottom: 12 }}>
              <select
                value={selectedCat}
                onChange={e => setSelectedCat(e.target.value)}
                className="fi"
                style={{ padding: '6px 8px', fontSize: 13, minWidth: 200 }}
              >
                <option value="">카테고리 선택...</option>
                {Array.from(new Set(categories)).filter(Boolean).sort().map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {/* 직접 입력 */}
          {mode === 'manual' && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                placeholder="시드 키워드 (쉼표 또는 줄바꿈으로 구분)&#10;예: 아쿠아슈즈, 수영복, 래시가드"
                value={manualSeeds}
                onChange={e => setManualSeeds(e.target.value)}
                style={{
                  width: '100%', minHeight: 60, padding: 8,
                  fontSize: 13, fontFamily: 'inherit',
                  border: '1px solid #E4E7EC', borderRadius: 6,
                }}
              />
            </div>
          )}

          {/* 옵션 + 실행 */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={useClaude} onChange={e => setUseClaude(e.target.checked)} />
              <span>Claude로 시드 확장 (시즌·트렌드 변형 추가)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={kidsOnly} onChange={e => setKidsOnly(e.target.checked)} />
              <span>👶 키즈/유아/베이비 전용 (성인 키워드 제외)</span>
            </label>
            <button
              onClick={runSuggest}
              disabled={loading || seedPool.length === 0}
              style={{
                padding: '8px 16px', borderRadius: 6,
                background: loading || seedPool.length === 0 ? '#94A3B8' : '#1570EF',
                color: '#fff', border: 'none', fontWeight: 700, fontSize: 13,
                cursor: loading || seedPool.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '⏳ 발굴 중...' : '🔍 키워드 발굴 시작'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>
              시드 {seedPool.length}개 준비됨
            </span>
          </div>

          {/* 에러 */}
          {error && (
            <div style={{ padding: 10, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              ❌ {error}
            </div>
          )}

          {/* 정보 */}
          {info && (
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
              ✓ 시드 {info.seedCount}개에서 {results.length}개 발굴
              {info.claudeUsed ? ' · Claude 시드 확장 사용' : ''}
              {info.adultFiltered > 0 ? ` · 성인 키워드 ${info.adultFiltered}개 제외됨` : ''}
            </div>
          )}

          {/* 결과 */}
          {results.length > 0 && (
            <div>
              {/* 기본 상품 일괄 선택 */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, padding: '8px 12px', background: '#F9FAFB', borderRadius: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>🎯 기본 연결 상품</span>
                <select
                  value={defaultProduct}
                  onChange={e => setDefaultProduct(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: 12, minWidth: 240, border: '1px solid #E4E7EC', borderRadius: 4 }}
                >
                  <option value="">— 선택 안 함 (행별로 지정) —</option>
                  {availableProducts.map(p => (
                    <option key={p.barcode} value={p.barcode}>{p.name} ({p.barcode})</option>
                  ))}
                </select>
                <span style={{ fontSize: 10, color: 'var(--t3)' }}>
                  행 드롭다운 비어있으면 기본 상품 사용
                </span>
              </div>

              <input
                placeholder="🔍 결과 내 검색..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="fi"
                style={{ padding: '6px 10px', fontSize: 12, marginBottom: 8, width: '100%' }}
              />
              <div style={{
                maxHeight: 500, overflowY: 'auto',
                border: '1px solid #E4E7EC', borderRadius: 6,
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: '8px 10px', textAlign: 'left',  borderBottom: '1px solid #E4E7EC' }}>키워드</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #E4E7EC' }}>월 검색량</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #E4E7EC' }}>경쟁</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left',  borderBottom: '1px solid #E4E7EC' }}>연결 상품</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #E4E7EC', width: 90 }}>등록</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(s => {
                      const isReg  = registered.has(s.keyword)
                      const isLoad = registering.has(s.keyword)
                      const compColor =
                        s.competition === 'high' ? '#DC2626' :
                        s.competition === 'mid'  ? '#D97706' : '#059669'
                      const compLabel =
                        s.competition === 'high' ? '높음' :
                        s.competition === 'mid'  ? '중간' : '낮음'
                      const selectedBc = rowProduct[s.keyword] || ''
                      return (
                        <tr key={s.keyword} style={{ borderTop: '1px solid #F3F4F6' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 600 }} title={`출처: ${s.sourceSeed}`}>
                            {s.keyword}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>
                            {s.total.toLocaleString('ko-KR')}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, color: compColor,
                              padding: '2px 6px', borderRadius: 4, background: compColor + '15',
                            }}>{compLabel}</span>
                          </td>
                          <td style={{ padding: '4px 10px' }}>
                            <select
                              value={selectedBc}
                              onChange={e => setRowProduct(prev => ({ ...prev, [s.keyword]: e.target.value }))}
                              disabled={isReg}
                              style={{
                                padding: '3px 6px', fontSize: 11, maxWidth: 220, width: '100%',
                                border: '1px solid #E4E7EC', borderRadius: 4,
                                background: selectedBc ? '#fff' : '#FEF3C7',
                              }}
                            >
                              <option value="">{defaultProduct ? '— 기본 사용 —' : '⚠️ 상품 선택...'}</option>
                              {availableProducts.map(p => (
                                <option key={p.barcode} value={p.barcode}>{p.name}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                            {isReg ? (
                              <span style={{ fontSize: 11, color: '#059669', fontWeight: 700 }}>✓ 등록됨</span>
                            ) : (
                              <button
                                onClick={() => registerKeyword(s)}
                                disabled={isLoad}
                                style={{
                                  padding: '4px 10px', fontSize: 11, borderRadius: 4,
                                  background: isLoad ? '#94A3B8' : '#1570EF',
                                  color: '#fff', border: 'none', fontWeight: 700,
                                  cursor: isLoad ? 'not-allowed' : 'pointer',
                                }}
                              >{isLoad ? '...' : '+ 등록'}</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

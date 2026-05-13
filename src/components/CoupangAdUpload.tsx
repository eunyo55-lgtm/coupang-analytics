'use client'
import { useRef, useState } from 'react'
import { parseCoupangAdCsv } from '@/lib/parseCoupangAdCsv'
import { supabase } from '@/lib/supabase'

interface Props {
  /** 업로드 성공 후 호출 — 부모가 차트/표를 새로고침할 때 사용 */
  onComplete?: () => void
}

export default function CoupangAdUpload({ onComplete }: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [unknownHeaders, setUnknownHeaders] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setResultMsg(null)
    setErrorMsg(null)
    setUnknownHeaders([])
    setProgress(null)

    try {
      if (!supabase) throw new Error('Supabase 클라이언트가 초기화되지 않았습니다')

      // 1) 파일 파싱
      const { rows, dates, unknownHeaders, totalSourceRows } = await parseCoupangAdCsv(file)
      setUnknownHeaders(unknownHeaders)

      if (rows.length === 0) {
        setErrorMsg(
          totalSourceRows === 0
            ? '데이터 row가 없는 파일입니다.'
            : `날짜 컬럼이 유효한 row가 없습니다. (전체 ${totalSourceRows}행 확인했지만 모두 날짜 누락 또는 형식 오류)`
        )
        return
      }

      // 2) 같은 날짜 기존 데이터 삭제 (재업로드 시 중복 방지)
      if (dates.length > 0) {
        const { error: delErr } = await supabase
          .from('coupang_ad_daily')
          .delete()
          .in('date', dates)
        if (delErr) throw new Error(`기존 데이터 삭제 실패: ${delErr.message}`)
      }

      // 3) 청크 단위 INSERT
      const CHUNK = 500
      let inserted = 0
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK)
        const { error: insErr } = await supabase.from('coupang_ad_daily').insert(chunk)
        if (insErr) throw new Error(`INSERT 실패 (chunk ${i}~${i + chunk.length}): ${insErr.message}`)
        inserted += chunk.length
        setProgress({ done: inserted, total: rows.length })
      }

      setResultMsg(
        `✅ ${rows.length.toLocaleString()}건 적재 완료 · ` +
        `${dates.length}일치 (${dates[0]} ~ ${dates[dates.length - 1]})`
      )
      if (onComplete) onComplete()
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setUploading(false)
      // 같은 파일 다시 업로드 가능하도록 input 초기화
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function onPick() {
    if (!uploading) inputRef.current?.click()
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    if (uploading) return
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div
      style={{
        background: 'white',
        border: '1px dashed #cbd5e1',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📤 광고 리포트 업로드</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            쿠팡 광고 어드민에서 일별 리포트를 다운로드한 후 CSV 또는 XLSX 파일을 끌어다 놓거나 클릭하세요.
            같은 날짜의 데이터가 이미 있으면 자동으로 덮어씁니다.
          </div>
        </div>
        <button
          onClick={onPick}
          disabled={uploading}
          style={{
            padding: '8px 16px',
            background: uploading ? '#cbd5e1' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: uploading ? 'not-allowed' : 'pointer',
          }}
        >
          {uploading ? '업로드 중…' : '파일 선택'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
        />
      </div>

      {progress && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
          저장 중: {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
        </div>
      )}

      {resultMsg && (
        <div style={{ marginTop: 10, padding: 8, background: '#d1fae5', color: '#065f46', borderRadius: 6, fontSize: 12 }}>
          {resultMsg}
        </div>
      )}

      {errorMsg && (
        <div style={{ marginTop: 10, padding: 8, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>
          ❌ {errorMsg}
        </div>
      )}

      {unknownHeaders.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer' }}>
            매핑되지 않은 헤더 {unknownHeaders.length}개 (참고용, 적재엔 영향 없음)
          </summary>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontFamily: 'monospace' }}>
            {unknownHeaders.join(' · ')}
          </div>
        </details>
      )}
    </div>
  )
}

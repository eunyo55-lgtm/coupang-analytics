'use client'

/**
 * 범용 stale-while-revalidate localStorage 캐시.
 *  - read: 즉시 반환 (만료 여부 포함). 호출부가 stale이면 백그라운드 refresh 수행.
 *  - write: 직렬화 후 저장. quota 초과 시 'swr_*' prefix 중 일부 제거 후 재시도.
 *  - 모든 키는 'swr_' prefix 권장 (quota 관리용).
 */

interface CacheEntry<T> {
  ts: number
  data: T
}

export interface CacheRead<T> {
  data: T
  stale: boolean
  ageMs: number
}

export function readSwrCache<T = unknown>(key: string, ttlMs: number): CacheRead<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const c = JSON.parse(raw) as CacheEntry<T>
    if (!c || typeof c.ts !== 'number') return null
    const age = Date.now() - c.ts
    return { data: c.data, stale: age > ttlMs, ageMs: age }
  } catch {
    return null
  }
}

export function writeSwrCache<T>(key: string, data: T) {
  if (typeof window === 'undefined') return
  const json = JSON.stringify({ ts: Date.now(), data })
  try {
    localStorage.setItem(key, json)
  } catch {
    // quota 초과 — swr_* 중 오래된 항목 정리 후 재시도
    try {
      const candidates: { k: string; ts: number }[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || !k.startsWith('swr_') || k === key) continue
        try {
          const raw = localStorage.getItem(k)
          const c = raw ? JSON.parse(raw) as CacheEntry<unknown> : null
          candidates.push({ k, ts: c?.ts ?? 0 })
        } catch { candidates.push({ k, ts: 0 }) }
      }
      candidates.sort((a, b) => a.ts - b.ts)
      for (const c of candidates.slice(0, 5)) localStorage.removeItem(c.k)
      localStorage.setItem(key, json)
    } catch {
      // 그래도 실패하면 캐시 포기
    }
  }
}

export function invalidateSwrCache(key: string) {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(key) } catch {}
}

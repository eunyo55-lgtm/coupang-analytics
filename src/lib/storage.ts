// IndexedDB 기반 스토리지 — localStorage 5MB 한도 문제 완전 해결
import type { SalesRow } from '@/types'

const DB_NAME = 'coupang_analytics'
const DB_VERSION = 1
const STORE_NAME = 'app_data'
const DATA_KEY = 'main'

export interface PersistedData {
  masterData: Record<string, unknown>[]
  salesData:  SalesRow[]
  ordersData: Record<string, unknown>[]
  supplyData: Record<string, unknown>[]
  dateRangePreset?: string
  hasData: boolean
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export async function persistData(data: PersistedData): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite')
      const req = tx.objectStore(STORE_NAME).put(data, DATA_KEY)
      req.onsuccess = () => resolve()
      req.onerror   = () => reject(req.error)
    })
    console.log('[CA] ✅ saved to IndexedDB:', {
      sales:  data.salesData.length,
      master: data.masterData.length,
      preset: data.dateRangePreset,
    })
  } catch (e) {
    console.warn('[CA] ❌ IndexedDB save failed:', e)
    // fallback: localStorage 시도 (용량 제한 있지만 최후 수단)
    try {
      const str = JSON.stringify(data)
      if (str.length < 4_500_000) localStorage.setItem('ca_data', str)
      else {
        const half = { ...data, salesData: data.salesData.slice(-Math.floor(data.salesData.length / 2)) }
        localStorage.setItem('ca_data', JSON.stringify(half))
      }
      console.log('[CA] ⚠️ fallback to localStorage')
    } catch { /* ignore */ }
  }
}

export async function loadData(): Promise<PersistedData | null> {
  if (typeof window === 'undefined') return null
  try {
    const db = await openDB()
    const result = await new Promise<PersistedData | undefined>((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(DATA_KEY)
      req.onsuccess = () => resolve(req.result)
      req.onerror   = () => reject(req.error)
    })
    if (result?.hasData) {
      console.log('[CA] ✅ loaded from IndexedDB:', { sales: result.salesData?.length, master: result.masterData?.length })
      return result
    }
  } catch (e) {
    console.warn('[CA] IndexedDB load failed:', e)
  }

  // fallback: localStorage에서 마이그레이션
  const OLD_KEYS = ['ca_data', 'ca_v7', 'ca_v6', 'ca_v5', 'coupang_analytics_data']
  for (const key of OLD_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const d = JSON.parse(raw) as PersistedData
        if (d.hasData) {
          console.log('[CA] 🔄 migrating from localStorage key:', key)
          await persistData(d) // IndexedDB로 마이그레이션
          OLD_KEYS.forEach(k => localStorage.removeItem(k)) // 구버전 정리
          return d
        }
      }
    } catch { /* ignore */ }
  }
  return null
}

export async function clearData(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite')
      const req = tx.objectStore(STORE_NAME).delete(DATA_KEY)
      req.onsuccess = () => resolve()
      req.onerror   = () => reject(req.error)
    })
  } catch { /* ignore */ }
  // localStorage도 정리
  ['ca_data','ca_v7','ca_v6','ca_v5','coupang_analytics_data'].forEach(k => {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  })
  console.log('[CA] 🗑️ cleared all data')
}

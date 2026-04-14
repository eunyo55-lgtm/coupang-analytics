'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect, useRef } from 'react'
import type { DateRange, SalesRow, InventoryItem, RankingEntry, AdEntry, ParseResult } from '@/types'
import { getPresetRange } from '@/lib/dateUtils'

const KEY = 'ca_data' // 최종 고정 키
const OLD_KEYS = ['ca_v1','ca_v2','ca_v3','ca_v4','ca_v5','ca_v6','ca_v7','coupang_analytics_data','coupang_analytics_v2']

// ── 저장/로드 ──
export function saveToLS(data: {
  masterData: Record<string,unknown>[]
  salesData: SalesRow[]
  ordersData: Record<string,unknown>[]
  supplyData: Record<string,unknown>[]
  dateRangePreset?: string
}) {
  if (typeof window === 'undefined') return
  try {
    const str = JSON.stringify({ ...data, hasData: true })
    if (str.length < 4_500_000) {
      localStorage.setItem(KEY, str)
    } else {
      // 판매 데이터 절반으로 줄여서 저장
      const half = { ...data, salesData: data.salesData.slice(-Math.floor(data.salesData.length / 2)), hasData: true }
      localStorage.setItem(KEY, JSON.stringify(half))
    }
    // 구버전 키 일괄 삭제
    OLD_KEYS.forEach(k => localStorage.removeItem(k))
    console.log('[CA] ✅ saved to localStorage:', {
      sales: data.salesData.length,
      master: data.masterData.length,
      preset: data.dateRangePreset,
    })
  } catch (e) {
    console.warn('[CA] ❌ save failed:', e)
  }
}

function loadFromLS() {
  if (typeof window === 'undefined') return null
  try {
    // 현재 키에서 먼저 로드 시도
    let raw = localStorage.getItem(KEY)
    // 없으면 구버전 키에서 마이그레이션
    if (!raw) {
      for (const oldKey of OLD_KEYS) {
        raw = localStorage.getItem(oldKey)
        if (raw) {
          console.log('[CA] 🔄 migrating from old key:', oldKey)
          localStorage.setItem(KEY, raw)   // 새 키로 복사
          localStorage.removeItem(oldKey)   // 구버전 삭제
          break
        }
      }
    }
    if (!raw) return null
    const d = JSON.parse(raw)
    console.log('[CA] ✅ loaded from localStorage:', { sales: d.salesData?.length, master: d.masterData?.length, preset: d.dateRangePreset })
    return d
  } catch { return null }
}

// ── merge ──
function mergeSales(prev: SalesRow[], next: SalesRow[]): SalesRow[] {
  if (!prev.length) return next
  const m = new Map<string, SalesRow>()
  prev.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  next.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date))
}
function mergeRaw(prev: Record<string,unknown>[], next: Record<string,unknown>[]) {
  if (!prev.length) return next
  const k = (r: Record<string,unknown>) => `${r['상품명']||r['productName']||r['item']||''}|${r['옵션']||r['option']||''}`
  const m = new Map<string, Record<string,unknown>>()
  prev.forEach(r => m.set(k(r), r))
  next.forEach(r => m.set(k(r), r))
  return Array.from(m.values())
}

// ── State ──
export interface AppState {
  dateRange: DateRange
  masterData: Record<string,unknown>[]
  salesData: SalesRow[]
  ordersData: Record<string,unknown>[]
  supplyData: Record<string,unknown>[]
  inventory: InventoryItem[]
  rankings: RankingEntry[]
  adEntries: AdEntry[]
  parseLog: string[]
  isAnalyzing: boolean
  hasData: boolean
}

const today = new Date(); today.setHours(0, 0, 0, 0)
const initialState: AppState = {
  dateRange: getPresetRange('yesterday', today),
  masterData: [], salesData: [], ordersData: [], supplyData: [],
  inventory: [], rankings: [], adEntries: [],
  parseLog: [], isAnalyzing: false, hasData: false,
}

// ── Actions ──
export type Action =
  | { type: 'SET_DATE_RANGE';   payload: DateRange }
  | { type: 'SET_PARSE_RESULT'; payload: ParseResult }
  | { type: 'HYDRATE';          payload: Partial<AppState> }
  | { type: 'SET_INVENTORY';    payload: InventoryItem[] }
  | { type: 'ADD_RANKING';      payload: RankingEntry }
  | { type: 'SET_RANKINGS';     payload: RankingEntry[] }
  | { type: 'ADD_AD_ENTRY';     payload: AdEntry }
  | { type: 'SET_AD_ENTRIES';   payload: AdEntry[] }
  | { type: 'DELETE_AD_ENTRY';  payload: number }
  | { type: 'APPEND_LOG';       payload: string }
  | { type: 'SET_ANALYZING';    payload: boolean }
  | { type: 'RESET' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATE_RANGE':   return { ...state, dateRange: action.payload }
    case 'HYDRATE':          return { ...state, ...action.payload }
    case 'SET_PARSE_RESULT': {
      const { key, data } = action.payload
      if (key === 'sales')  return { ...state, salesData:  mergeSales(state.salesData, data as unknown as SalesRow[]), hasData: true }
      if (key === 'master') return { ...state, masterData: mergeRaw(state.masterData, data), hasData: true }
      if (key === 'orders') return { ...state, ordersData: mergeRaw(state.ordersData, data), hasData: true }
      return { ...state, supplyData: data, hasData: true }
    }
    case 'SET_INVENTORY':    return { ...state, inventory: action.payload }
    case 'ADD_RANKING':      return { ...state, rankings: [action.payload, ...state.rankings] }
    case 'SET_RANKINGS':     return { ...state, rankings: action.payload }
    case 'ADD_AD_ENTRY':     return { ...state, adEntries: [...state.adEntries, action.payload] }
    case 'SET_AD_ENTRIES':   return { ...state, adEntries: action.payload }
    case 'DELETE_AD_ENTRY':  return { ...state, adEntries: state.adEntries.filter((_, i) => i !== action.payload) }
    case 'APPEND_LOG':       return { ...state, parseLog: [...state.parseLog, action.payload] }
    case 'SET_ANALYZING':    return { ...state, isAnalyzing: action.payload }
    case 'RESET':
      if (typeof window !== 'undefined') localStorage.removeItem(KEY)
      return { ...initialState, dateRange: state.dateRange }
    default: return state
  }
}

// ── Context ──
const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<Action>
} | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const isHydrating = useRef(false)

  // 마운트 후 localStorage에서 복원
  useEffect(() => {
    const saved = loadFromLS()
    if (!saved?.hasData) return

    isHydrating.current = true
    const today2 = new Date(); today2.setHours(0, 0, 0, 0)
    const dateRange = saved.dateRangePreset
      ? getPresetRange(saved.dateRangePreset, today2)
      : getPresetRange('total', today2) // 데이터 있으면 기본값 전체

    dispatch({
      type: 'HYDRATE',
      payload: {
        masterData: saved.masterData || [],
        salesData:  saved.salesData  || [],
        ordersData: saved.ordersData || [],
        supplyData: saved.supplyData || [],
        hasData:    true,
        dateRange,
      },
    })
    // hydration 완료 표시
    setTimeout(() => { isHydrating.current = false }, 200)
  }, []) // eslint-disable-line

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be within AppProvider')
  return ctx
}
// cache bust Tue Apr 14 04:57:16 UTC 2026

'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect, useRef } from 'react'
import type { DateRange, SalesRow, InventoryItem, RankingEntry, AdEntry, ParseResult } from '@/types'
import { getPresetRange } from '@/lib/dateUtils'
import { persistData, loadData, clearData } from '@/lib/storage'

export { persistData } // datamanage/page.tsx에서 import용

// ── merge ──
function mergeSales(prev: SalesRow[], next: SalesRow[]): SalesRow[] {
  if (!prev.length) return next
  const m = new Map<string, SalesRow>()
  prev.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  next.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date))
}
function mergeRaw(prev: Record<string,unknown>[], next: Record<string,unknown>[]): Record<string,unknown>[] {
  if (!prev.length) return next
  const k = (r: Record<string,unknown>) =>
    `${r['상품명']||r['productName']||r['item']||''}|${r['옵션']||r['option']||''}`
  const m = new Map<string, Record<string,unknown>>()
  prev.forEach(r => m.set(k(r), r))
  next.forEach(r => m.set(k(r), r))
  return Array.from(m.values())
}

// ── State ──
export interface AppState {
  dateRange:   DateRange
  masterData:  Record<string,unknown>[]
  salesData:   SalesRow[]
  ordersData:  Record<string,unknown>[]
  supplyData:  Record<string,unknown>[]
  inventory:   InventoryItem[]
  rankings:    RankingEntry[]
  adEntries:   AdEntry[]
  parseLog:    string[]
  isAnalyzing: boolean
  hasData:     boolean
}

const today = new Date(); today.setHours(0,0,0,0)
export const initialState: AppState = {
  dateRange:   getPresetRange('yesterday', today),
  masterData:  [], salesData:   [], ordersData:  [], supplyData:  [],
  inventory:   [], rankings:    [], adEntries:   [],
  parseLog:    [], isAnalyzing: false, hasData: false,
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
    case 'SET_INVENTORY':   return { ...state, inventory:  action.payload }
    case 'ADD_RANKING':     return { ...state, rankings:   [action.payload, ...state.rankings] }
    case 'SET_RANKINGS':    return { ...state, rankings:   action.payload }
    case 'ADD_AD_ENTRY':    return { ...state, adEntries:  [...state.adEntries, action.payload] }
    case 'SET_AD_ENTRIES':  return { ...state, adEntries:  action.payload }
    case 'DELETE_AD_ENTRY': return { ...state, adEntries:  state.adEntries.filter((_, i) => i !== action.payload) }
    case 'APPEND_LOG':      return { ...state, parseLog:   [...state.parseLog, action.payload] }
    case 'SET_ANALYZING':   return { ...state, isAnalyzing: action.payload }
    case 'RESET':
      clearData()
      return { ...initialState, dateRange: state.dateRange }
    default: return state
  }
}

// ── Context ──
const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const hydrated = useRef(false)

  // 마운트 시 IndexedDB에서 복원
  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    loadData().then(saved => {
      if (!saved?.hasData) return
      const t = new Date(); t.setHours(0,0,0,0)
      dispatch({
        type: 'HYDRATE',
        payload: {
          masterData: saved.masterData || [],
          salesData:  saved.salesData  || [],
          ordersData: saved.ordersData || [],
          supplyData: saved.supplyData || [],
          hasData:    true,
          dateRange:  getPresetRange(saved.dateRangePreset || 'total', t),
        },
      })
    })
  }, [])

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be within AppProvider')
  return ctx
}

'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect, useRef } from 'react'
import type {
  DateRange, SalesRow, InventoryItem,
  RankingEntry, AdEntry, ParseResult
} from '@/types'
import { getPresetRange } from '@/lib/dateUtils'

const STORAGE_KEY = 'ca_data_v3'

// ── 즉시 저장 (dispatch 후 바로 호출) ──
export function persistState(state: AppState) {
  if (typeof window === 'undefined') return
  try {
    const payload = {
      masterData: state.masterData,
      salesData:  state.salesData,
      ordersData: state.ordersData,
      supplyData: state.supplyData,
      hasData:    state.hasData,
    }
    const str = JSON.stringify(payload)
    if (str.length < 4_500_000) {
      localStorage.setItem(STORAGE_KEY, str)
    } else {
      payload.salesData = state.salesData.slice(-Math.floor(state.salesData.length / 2))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    }
  } catch (e) {
    console.warn('[store] save failed', e)
  }
}

export function loadPersistedState(): Partial<AppState> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

// ── merge 헬퍼 ──
function mergeSales(existing: SalesRow[], incoming: SalesRow[]): SalesRow[] {
  if (!existing.length) return incoming
  const map = new Map<string, SalesRow>()
  existing.forEach(r => map.set(`${r.date}||${r.productName}||${r.option}`, r))
  incoming.forEach(r => map.set(`${r.date}||${r.productName}||${r.option}`, r))
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function mergeByName(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[]
): Record<string, unknown>[] {
  if (!existing.length) return incoming
  const key = (r: Record<string, unknown>) =>
    `${r['상품명'] || r['productName'] || r['item'] || ''}||${r['옵션'] || r['option'] || ''}`
  const map = new Map<string, Record<string, unknown>>()
  existing.forEach(r => map.set(key(r), r))
  incoming.forEach(r => map.set(key(r), r))
  return Array.from(map.values())
}

// ── State ──
export interface AppState {
  dateRange:   DateRange
  masterData:  Record<string, unknown>[]
  salesData:   SalesRow[]
  ordersData:  Record<string, unknown>[]
  supplyData:  Record<string, unknown>[]
  inventory:   InventoryItem[]
  rankings:    RankingEntry[]
  adEntries:   AdEntry[]
  parseLog:    string[]
  isAnalyzing: boolean
  hasData:     boolean
}

const today = new Date()
today.setHours(0, 0, 0, 0)

export const initialState: AppState = {
  dateRange:   getPresetRange('yesterday', today),
  masterData:  [],
  salesData:   [],
  ordersData:  [],
  supplyData:  [],
  inventory:   [],
  rankings:    [],
  adEntries:   [],
  parseLog:    [],
  isAnalyzing: false,
  hasData:     false,
}

// ── Actions ──
export type Action =
  | { type: 'SET_DATE_RANGE';     payload: DateRange }
  | { type: 'SET_PARSE_RESULT';   payload: ParseResult }
  | { type: 'HYDRATE';            payload: Partial<AppState> }
  | { type: 'SET_INVENTORY';      payload: InventoryItem[] }
  | { type: 'ADD_RANKING';        payload: RankingEntry }
  | { type: 'SET_RANKINGS';       payload: RankingEntry[] }
  | { type: 'ADD_AD_ENTRY';       payload: AdEntry }
  | { type: 'SET_AD_ENTRIES';     payload: AdEntry[] }
  | { type: 'DELETE_AD_ENTRY';    payload: number }
  | { type: 'APPEND_LOG';         payload: string }
  | { type: 'SET_ANALYZING';      payload: boolean }
  | { type: 'RESET' }

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATE_RANGE':
      return { ...state, dateRange: action.payload }

    case 'HYDRATE':
      return { ...state, ...action.payload }

    case 'SET_PARSE_RESULT': {
      const { key, data } = action.payload
      let next: AppState
      if (key === 'sales') {
        const incoming = data as unknown as SalesRow[]
        next = { ...state, salesData: mergeSales(state.salesData, incoming), hasData: true }
      } else if (key === 'master') {
        next = { ...state, masterData: mergeByName(state.masterData, data), hasData: true }
      } else if (key === 'orders') {
        next = { ...state, ordersData: mergeByName(state.ordersData, data), hasData: true }
      } else {
        next = { ...state, supplyData: data, hasData: true }
      }
      // 즉시 저장
      persistState(next)
      return next
    }

    case 'SET_INVENTORY':
      return { ...state, inventory: action.payload }

    case 'ADD_RANKING':
      return { ...state, rankings: [action.payload, ...state.rankings] }

    case 'SET_RANKINGS':
      return { ...state, rankings: action.payload }

    case 'ADD_AD_ENTRY':
      return { ...state, adEntries: [...state.adEntries, action.payload] }

    case 'SET_AD_ENTRIES':
      return { ...state, adEntries: action.payload }

    case 'DELETE_AD_ENTRY':
      return { ...state, adEntries: state.adEntries.filter((_, i) => i !== action.payload) }

    case 'APPEND_LOG':
      return { ...state, parseLog: [...state.parseLog, action.payload] }

    case 'SET_ANALYZING':
      return { ...state, isAnalyzing: action.payload }

    case 'RESET': {
      if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
      return { ...initialState, dateRange: state.dateRange }
    }

    default:
      return state
  }
}

// ── Context ──
const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<Action>
} | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const hydrated = useRef(false)

  // 클라이언트 마운트 후 1회만 복원
  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    const saved = loadPersistedState()
    if (saved?.hasData) {
      dispatch({ type: 'HYDRATE', payload: saved })
    }
  }, [])

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

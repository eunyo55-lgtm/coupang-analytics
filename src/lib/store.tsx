'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect, useRef } from 'react'
import type {
  DateRange, SalesRow, InventoryItem,
  RankingEntry, AdEntry, ParseResult
} from '@/types'
import { getPresetRange } from '@/lib/dateUtils'

// ── localStorage 유틸 ──
const STORAGE_KEY = 'coupang_analytics_v2'

function saveToStorage(state: AppState) {
  try {
    const toSave = {
      masterData: state.masterData,
      salesData:  state.salesData,
      ordersData: state.ordersData,
      supplyData: state.supplyData,
      hasData:    state.hasData,
    }
    const str = JSON.stringify(toSave)
    if (str.length < 4_500_000) {
      localStorage.setItem(STORAGE_KEY, str)
    } else {
      // 용량 초과 시 판매 데이터를 최신 절반만 유지
      toSave.salesData = state.salesData.slice(-Math.floor(state.salesData.length / 2))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    }
    console.log('[store] saved to localStorage:', {
      sales: toSave.salesData.length,
      master: toSave.masterData.length,
    })
  } catch (e) {
    console.warn('[store] localStorage save failed:', e)
  }
}

function loadFromStorage(): Partial<AppState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    console.log('[store] loaded from localStorage:', {
      sales: parsed.salesData?.length,
      master: parsed.masterData?.length,
    })
    return parsed
  } catch { return null }
}

// ── 누적 merge 헬퍼 ──
function mergeSales(existing: SalesRow[], incoming: SalesRow[]): SalesRow[] {
  if (!existing.length) return incoming
  const map = new Map<string, SalesRow>()
  existing.forEach(r => {
    map.set(`${r.date}||${r.productName}||${r.option}`, r)
  })
  incoming.forEach(r => {
    map.set(`${r.date}||${r.productName}||${r.option}`, r)
  })
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function mergeByName(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[]
): Record<string, unknown>[] {
  if (!existing.length) return incoming
  const nameKey = (r: Record<string, unknown>) => {
    const name   = r['상품명'] || r['productName'] || r['item'] || r['노출상품명'] || ''
    const option = r['옵션']  || r['option']      || r['옵션명'] || ''
    return `${name}||${option}`
  }
  const map = new Map<string, Record<string, unknown>>()
  existing.forEach(r => map.set(nameKey(r), r))
  incoming.forEach(r => map.set(nameKey(r), r))
  return Array.from(map.values())
}

// ── State ──
interface AppState {
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

const initialState: AppState = {
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
type Action =
  | { type: 'SET_DATE_RANGE';  payload: DateRange }
  | { type: 'SET_PARSE_RESULT'; payload: ParseResult }
  | { type: 'LOAD_FROM_STORAGE'; payload: Partial<AppState> }
  | { type: 'SET_INVENTORY';   payload: InventoryItem[] }
  | { type: 'ADD_RANKING';     payload: RankingEntry }
  | { type: 'SET_RANKINGS';    payload: RankingEntry[] }
  | { type: 'ADD_AD_ENTRY';    payload: AdEntry }
  | { type: 'SET_AD_ENTRIES';  payload: AdEntry[] }
  | { type: 'DELETE_AD_ENTRY'; payload: number }
  | { type: 'APPEND_LOG';      payload: string }
  | { type: 'SET_ANALYZING';   payload: boolean }
  | { type: 'RESET' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATE_RANGE':
      return { ...state, dateRange: action.payload }

    case 'LOAD_FROM_STORAGE':
      return { ...state, ...action.payload }

    case 'SET_PARSE_RESULT': {
      const { key, data } = action.payload
      if (key === 'sales') {
        const incoming = data as unknown as SalesRow[]
        return { ...state, salesData: mergeSales(state.salesData, incoming), hasData: true }
      }
      if (key === 'master') {
        return { ...state, masterData: mergeByName(state.masterData, data), hasData: true }
      }
      if (key === 'orders') {
        return { ...state, ordersData: mergeByName(state.ordersData, data), hasData: true }
      }
      if (key === 'supply') {
        // 공급 중 수량은 항상 교체
        return { ...state, supplyData: data, hasData: true }
      }
      return { ...state, hasData: true }
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
      localStorage.removeItem(STORAGE_KEY)
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
  const isFirstRender = useRef(true)

  // 마운트 시 localStorage에서 데이터 복원 (클라이언트 전용)
  useEffect(() => {
    const saved = loadFromStorage()
    if (saved && saved.hasData) {
      dispatch({ type: 'LOAD_FROM_STORAGE', payload: saved })
    }
  }, [])

  // 데이터 변경 시 localStorage에 저장 (첫 렌더 이후부터)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (state.hasData) {
      saveToStorage(state)
    }
  }, [state.masterData, state.salesData, state.ordersData, state.supplyData, state.hasData]) // eslint-disable-line

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

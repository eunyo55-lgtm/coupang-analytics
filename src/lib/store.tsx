'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect } from 'react'
import type {
  DateRange, SalesRow, InventoryItem,
  RankingEntry, AdEntry, ParseResult
} from '@/types'
import { getPresetRange } from '@/lib/dateUtils'

// ── localStorage 유틸 ──
const STORAGE_KEY = 'coupang_analytics_data'

function saveToStorage(state: AppState) {
  try {
    const toSave = {
      masterData: state.masterData,
      salesData:  state.salesData,
      ordersData: state.ordersData,
      supplyData: state.supplyData,
      hasData:    state.hasData,
    }
    // 5MB 초과 방지: 용량 측정 후 잘라내기
    const str = JSON.stringify(toSave)
    if (str.length < 4_500_000) {
      localStorage.setItem(STORAGE_KEY, str)
    } else {
      // 판매 데이터가 제일 크므로 절반만 저장
      toSave.salesData = state.salesData.slice(0, Math.floor(state.salesData.length / 2))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    }
  } catch {
    // 용량 초과 시 무시
    console.warn('[store] localStorage save failed')
  }
}

function loadFromStorage(): Partial<AppState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch { return {} }
}

// ── State ──
interface AppState {
  dateRange: DateRange
  masterData: Record<string, unknown>[]
  salesData: SalesRow[]
  ordersData: Record<string, unknown>[]
  supplyData: Record<string, unknown>[]
  inventory: InventoryItem[]
  rankings: RankingEntry[]
  adEntries: AdEntry[]
  parseLog: string[]
  isAnalyzing: boolean
  hasData: boolean
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
  | { type: 'SET_DATE_RANGE'; payload: DateRange }
  | { type: 'SET_PARSE_RESULT'; payload: ParseResult }
  | { type: 'SET_INVENTORY'; payload: InventoryItem[] }
  | { type: 'ADD_RANKING'; payload: RankingEntry }
  | { type: 'SET_RANKINGS'; payload: RankingEntry[] }
  | { type: 'ADD_AD_ENTRY'; payload: AdEntry }
  | { type: 'SET_AD_ENTRIES'; payload: AdEntry[] }
  | { type: 'DELETE_AD_ENTRY'; payload: number }
  | { type: 'APPEND_LOG'; payload: string }
  | { type: 'SET_ANALYZING'; payload: boolean }
  | { type: 'RESET' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATE_RANGE':
      return { ...state, dateRange: action.payload }

    case 'SET_PARSE_RESULT': {
      const { key, data } = action.payload
      const keyMap: Record<string, keyof AppState> = {
        master: 'masterData',
        sales:  'salesData',
        orders: 'ordersData',
        supply: 'supplyData',
      }
      return { ...state, [keyMap[key]]: data, hasData: true }
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
  const [state, dispatch] = useReducer(reducer, initialState, (base) => {
    const saved = loadFromStorage()
    return { ...base, ...saved }
  })

  // 데이터가 바뀔 때마다 localStorage에 저장
  useEffect(() => {
    if (state.hasData) saveToStorage(state)
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

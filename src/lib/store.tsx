'use client'

import React, { createContext, useContext, useReducer, ReactNode } from 'react'
import type {
  DateRange, SalesRow, InventoryItem,
  RankingEntry, AdEntry, ParseResult
} from '@/types'
import { getPresetRange } from '@/lib/dateUtils'

// ── State ──
interface AppState {
  dateRange: DateRange
  // raw parsed data
  masterData: Record<string, unknown>[]
  salesData: SalesRow[]
  ordersData: Record<string, unknown>[]
  supplyData: Record<string, unknown>[]
  // computed
  inventory: InventoryItem[]
  rankings: RankingEntry[]
  adEntries: AdEntry[]
  // status
  parseLog: string[]
  isAnalyzing: boolean
  hasData: boolean
}

const today = new Date()
today.setHours(0, 0, 0, 0)

const initialState: AppState = {
  dateRange: getPresetRange('yesterday', today),
  masterData: [],
  salesData: [],
  ordersData: [],
  supplyData: [],
  inventory: [],
  rankings: [],
  adEntries: [],
  parseLog: [],
  isAnalyzing: false,
  hasData: false,
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
      return {
        ...state,
        [keyMap[key]]: data,
        hasData: true,
      }
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
      return {
        ...state,
        adEntries: state.adEntries.filter((_, i) => i !== action.payload),
      }

    case 'APPEND_LOG':
      return { ...state, parseLog: [...state.parseLog, action.payload] }

    case 'SET_ANALYZING':
      return { ...state, isAnalyzing: action.payload }

    case 'RESET':
      return { ...initialState, dateRange: state.dateRange }

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

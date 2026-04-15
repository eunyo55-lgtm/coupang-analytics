'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect, useRef, useState } from 'react'
import type { DateRange, SalesRow, InventoryItem, RankingEntry, AdEntry } from '@/types'
import { getPresetRange } from '@/lib/dateUtils'
import { loadData, clearData, PersistedData } from '@/lib/storage'

export type { PersistedData }

export interface AppState {
  dateRange:    DateRange
  // RPC 집계 데이터
  stockSummary: PersistedData['stockSummary']
  daily26:      { date: string; qty: number }[]
  daily25:      { date: string; qty: number }[]
  daily24:      { date: string; qty: number }[]
  latestSaleDate: string
  // 부가 데이터
  ordersData:   Record<string,unknown>[]
  supplyData:   Record<string,unknown>[]
  // 레거시 (다른 페이지 호환)
  masterData:   Record<string,unknown>[]
  salesData:    SalesRow[]
  products:     never[]
  // UI
  inventory:    InventoryItem[]
  rankings:     RankingEntry[]
  adEntries:    AdEntry[]
  parseLog:     string[]
  isAnalyzing:  boolean
  hasData:      boolean
}

const today = new Date(); today.setHours(0,0,0,0)
const emptyStock = { total_stock: 0, stock_value: 0 }

export const initialState: AppState = {
  dateRange:      getPresetRange('yesterday', today),
  stockSummary:   emptyStock,
  daily26:        [], daily25:  [], daily24:       [],
  latestSaleDate: '',
  ordersData:     [], supplyData: [], masterData:   [],
  salesData:      [] as never[], products: [] as never[],
  inventory:      [], rankings:  [], adEntries:    [],
  parseLog:       [], isAnalyzing: false, hasData:  false,
}

export type Action =
  | { type: 'SET_DATE_RANGE';  payload: DateRange }
  | { type: 'HYDRATE';         payload: Partial<AppState> }
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
    case 'SET_DATE_RANGE':   return { ...state, dateRange: action.payload }
    case 'HYDRATE':          return { ...state, ...action.payload }
    case 'ADD_RANKING':      return { ...state, rankings:  [action.payload, ...state.rankings] }
    case 'SET_RANKINGS':     return { ...state, rankings:  action.payload }
    case 'ADD_AD_ENTRY':     return { ...state, adEntries: [...state.adEntries, action.payload] }
    case 'SET_AD_ENTRIES':   return { ...state, adEntries: action.payload }
    case 'DELETE_AD_ENTRY':  return { ...state, adEntries: state.adEntries.filter((_,i) => i !== action.payload) }
    case 'APPEND_LOG':       return { ...state, parseLog:  [...state.parseLog, action.payload] }
    case 'SET_ANALYZING':    return { ...state, isAnalyzing: action.payload }
    case 'RESET':
      clearData()
      return { ...initialState }
    default: return state
  }
}

const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<Action>
  isReady: boolean
} | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [isReady, setIsReady] = useState(false)
  const hydrated = useRef(false)

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    loadData().then((saved: PersistedData | null) => {
      if (saved?.hasData) {
        dispatch({
          type: 'HYDRATE',
          payload: {
            stockSummary:   saved.stockSummary,
            daily26:        saved.daily26,
            daily25:        saved.daily25,
            daily24:        saved.daily24,
            latestSaleDate: saved.latestSaleDate,
            ordersData:     saved.ordersData,
            supplyData:     saved.supplyData,
            hasData:        true,
          },
        })
      }
      setIsReady(true)
    }).catch(() => setIsReady(true))
  }, [])

  return <AppContext.Provider value={{ state, dispatch, isReady }}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be within AppProvider')
  return ctx
}

'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect, useRef, useState } from 'react'
import type { DateRange, SalesRow, InventoryItem, RankingEntry, AdEntry, ParseResult, Product } from '@/types'
import { getPresetRange } from '@/lib/dateUtils'
import { persistData, loadData, clearData, PersistedData } from '@/lib/storage'

export { persistData }

function mergeSales(prev: SalesRow[], next: SalesRow[]): SalesRow[] {
  if (!prev.length) return next
  const m = new Map<string, SalesRow>()
  prev.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  next.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  return Array.from(m.values()).sort((a,b) => a.date.localeCompare(b.date))
}
function mergeRaw(prev: Record<string,unknown>[], next: Record<string,unknown>[]): Record<string,unknown>[] {
  if (!prev.length) return next
  const k = (r: Record<string,unknown>) => `${r['상품명']||r['name']||''}|${r['옵션']||r['option_value']||''}`
  const m = new Map<string, Record<string,unknown>>()
  prev.forEach(r => m.set(k(r), r)); next.forEach(r => m.set(k(r), r))
  return Array.from(m.values())
}

export interface AppState {
  dateRange:    DateRange
  masterData:   Record<string,unknown>[]
  salesData:    SalesRow[]
  salesData24:  SalesRow[]
  salesData25:  SalesRow[]
  products:     Product[]
  ordersData:   Record<string,unknown>[]
  supplyData:   Record<string,unknown>[]
  inventory:    InventoryItem[]
  rankings:     RankingEntry[]
  adEntries:    AdEntry[]
  parseLog:     string[]
  isAnalyzing:  boolean
  hasData:      boolean
  daily24: {date:string,qty:number}[]
  daily25: {date:string,qty:number}[]
  daily26: {date:string,qty:number}[]
}

const today = new Date(); today.setHours(0,0,0,0)
export const initialState: AppState = {
  dateRange:   getPresetRange('yesterday', today),
  masterData:  [], salesData:   [], salesData24: [], salesData25: [],
  products:    [], ordersData:  [], supplyData:  [],
  inventory:   [], rankings:    [], adEntries:   [],
  parseLog:    [], isAnalyzing: false, hasData: false,
  daily24: [], daily25: [], daily26: [],
}

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
    case 'DELETE_AD_ENTRY': return { ...state, adEntries:  state.adEntries.filter((_,i) => i !== action.payload) }
    case 'APPEND_LOG':      return { ...state, parseLog:   [...state.parseLog, action.payload] }
    case 'SET_ANALYZING':   return { ...state, isAnalyzing: action.payload }
    case 'RESET':
      clearData()
      return { ...initialState, dateRange: state.dateRange }
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
        const t = new Date(); t.setHours(0,0,0,0)
        dispatch({
          type: 'HYDRATE',
          payload: {
            masterData:  saved.masterData  || [],
            salesData:   saved.salesData   || [],
            salesData24: saved.salesData24 || [],
            salesData25: saved.salesData25 || [],
            products:    saved.products    || [],
            ordersData:  saved.ordersData  || [],
            supplyData:  saved.supplyData  || [],
            hasData:     true,
            daily24: (saved as Record<string,unknown>)._daily24 as {date:string,qty:number}[] || [],
            daily25: (saved as Record<string,unknown>)._daily25 as {date:string,qty:number}[] || [],
            daily26: (saved as Record<string,unknown>)._daily26 as {date:string,qty:number}[] || [],
            dateRange:   getPresetRange(saved.dateRangePreset || 'yesterday', t),
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

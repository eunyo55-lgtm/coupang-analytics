'use client'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const supabase = typeof window !== 'undefined'
  ? createClient(url, key)
  : null as unknown as ReturnType<typeof createClient>

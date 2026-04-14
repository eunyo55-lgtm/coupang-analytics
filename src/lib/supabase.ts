'use client'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// db.max-rows 제한 해제를 위해 global headers에 Range 설정
export const supabase = typeof window !== 'undefined'
  ? createClient(url, key, {
      global: {
        headers: {
          'Accept-Profile': 'public',
          'Prefer': 'return=minimal',
        }
      },
      db: { schema: 'public' },
    })
  : null as unknown as ReturnType<typeof createClient>

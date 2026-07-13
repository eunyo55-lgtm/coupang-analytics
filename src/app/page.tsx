'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// 홈 '/' 진입 시 판매 현황으로 리다이렉트 (대시보드 페이지 폐기)
export default function Home() {
  const router = useRouter()
  useEffect(() => { router.replace('/sales') }, [router])
  return null
}

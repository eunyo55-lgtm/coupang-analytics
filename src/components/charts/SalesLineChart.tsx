'use client'

import { useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js'
import type { DailySales } from '@/types'

Chart.register(...registerables)

interface Props {
  data: DailySales[]
  height?: number
}

export default function SalesLineChart({ data, height = 230 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef  = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    if (chartRef.current) { chartRef.current.destroy() }

    const labels = data.map(d => d.date.slice(5))   // MM-DD
    const values = data.map(d => d.revenue)
    const showPoints = data.length <= 30

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '매출',
          data: values,
          borderColor: '#1570EF',
          backgroundColor: 'rgba(21,112,239,.07)',
          fill: true,
          tension: 0.35,
          pointRadius: showPoints ? 2.5 : 0,
          pointBackgroundColor: '#1570EF',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ' ' + Math.round(ctx.parsed.y).toLocaleString('ko-KR'),
            },
          },
        },
        scales: {
          x: {
            ticks: { font: { size: 9, weight: 'bold' }, color: '#9BA5B4', maxTicksLimit: 10 },
            grid:  { color: 'rgba(0,0,0,.03)' },
          },
          y: {
            ticks: {
              font: { size: 9, weight: 'bold' },
              color: '#9BA5B4',
              callback: v => Number(v).toLocaleString('ko-KR'),
            },
            grid: { color: 'rgba(0,0,0,.03)' },
          },
        },
      },
    })

    return () => { chartRef.current?.destroy() }
  }, [data])

  return (
    <div style={{ position: 'relative', height }}>
      <canvas ref={canvasRef} role="img" aria-label="판매 추이 꺾은선 차트" />
    </div>
  )
}

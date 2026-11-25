'use client'

import { useEffect, useRef, useState } from 'react'
import { Eraser, Pen, RotateCcw, X } from 'lucide-react'

type Point = { x: number; y: number }
type Stroke = { points: Point[]; color: string; width: number; eraser?: boolean }

export function InkCanvas({ onClose, onSave }: { onClose: () => void; onSave: (dataUrl: string, strokes: unknown[]) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [current, setCurrent] = useState<Stroke | null>(null)
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [paper, setPaper] = useState<'blank' | 'lines' | 'grid'>('grid')
  const [color, setColor] = useState('#3f2c29')
  const [width, setWidth] = useState(3)
  const [saving, setSaving] = useState(false)

  const draw = () => {
    const element = canvas.current
    if (!element) return
    const rect = element.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1)
    const targetWidth = Math.max(1, Math.round(rect.width * ratio)), targetHeight = Math.max(1, Math.round(rect.height * ratio))
    if (element.width !== targetWidth || element.height !== targetHeight) { element.width = targetWidth; element.height = targetHeight }
    const context = element.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, element.width, element.height)
    context.fillStyle = '#fffdf9'; context.fillRect(0, 0, element.width, element.height)
    context.strokeStyle = 'rgba(120,95,85,.12)'; context.lineWidth = 1
    const spacing = 28 * ratio
    if (paper === 'lines' || paper === 'grid') for (let y = spacing; y < element.height; y += spacing) { context.beginPath(); context.moveTo(0, y); context.lineTo(element.width, y); context.stroke() }
    if (paper === 'grid') for (let x = spacing; x < element.width; x += spacing) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, element.height); context.stroke() }
    for (const stroke of [...strokes, ...(current ? [current] : [])]) {
      if (stroke.points.length < 2) continue
      context.save(); context.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over'
      context.strokeStyle = stroke.color; context.lineWidth = stroke.width * ratio; context.lineCap = 'round'; context.lineJoin = 'round'
      context.beginPath(); context.moveTo(stroke.points[0].x * element.width, stroke.points[0].y * element.height)
      for (const point of stroke.points.slice(1)) context.lineTo(point.x * element.width, point.y * element.height)
      context.stroke(); context.restore()
    }
  }
  useEffect(draw, [strokes, current, paper])
  useEffect(() => { const resize = () => draw(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) })

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setCurrent({ points: [point(event)], color, width: tool === 'eraser' ? Math.max(12, width * 4) : width, eraser: tool === 'eraser' })
  }
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => { if (current) setCurrent(value => value ? { ...value, points: [...value.points, point(event)] } : value) }
  const end = () => { if (current?.points.length) setStrokes(value => [...value, current]); setCurrent(null) }
  const save = async () => {
    if (!canvas.current || !strokes.length) return
    setSaving(true)
    try { await onSave(canvas.current.toDataURL('image/png'), [{ paper }, ...strokes]) } finally { setSaving(false) }
  }

  return <div className="fixed inset-0 z-[140] flex flex-col bg-[#f6efe8] text-[#3f2c29] dark:bg-night-bg dark:text-night-text">
    <header className="flex items-center gap-2 border-b border-current/10 px-3 pb-3 pt-[max(.75rem,env(safe-area-inset-top))]">
      <button aria-label="关闭手写" onClick={onClose} className="rounded-full p-2"><X size={18}/></button>
      <div className="flex-1 text-sm font-medium">手写卡片</div>
      <button aria-label="撤销" disabled={!strokes.length} onClick={() => setStrokes(value => value.slice(0, -1))} className="rounded-full p-2 disabled:opacity-25"><RotateCcw size={17}/></button>
      <button disabled={!strokes.length || saving} onClick={() => void save()} className="rounded-full bg-[#d8b0aa] px-4 py-2 text-xs text-[#3f2c29] disabled:opacity-30">{saving ? '保存中' : '插入'}</button>
    </header>
    <div className="flex flex-wrap items-center gap-2 border-b border-current/10 px-4 py-2 text-xs">
      <button aria-pressed={tool === 'pen'} onClick={() => setTool('pen')} className={`rounded-full p-2 ${tool === 'pen' ? 'bg-current/10' : ''}`}><Pen size={15}/></button>
      <button aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')} className={`rounded-full p-2 ${tool === 'eraser' ? 'bg-current/10' : ''}`}><Eraser size={15}/></button>
      {['#3f2c29', '#a15462', '#365f7a', '#3f7257'].map(item => <button key={item} aria-label={`颜色 ${item}`} onClick={() => { setColor(item); setTool('pen') }} className={`h-6 w-6 rounded-full border-2 ${color === item && tool === 'pen' ? 'border-current' : 'border-transparent'}`} style={{ background: item }}/>) }
      <input aria-label="笔画粗细" type="range" min="1" max="8" value={width} onChange={event => setWidth(Number(event.target.value))} className="w-24"/>
      <span className="mx-1 h-5 w-px bg-current/10"/>
      {([['blank', '空白'], ['lines', '横线'], ['grid', '方格']] as const).map(([value, label]) => <button key={value} onClick={() => setPaper(value)} className={`rounded-full px-3 py-1 ${paper === value ? 'bg-current/10' : 'opacity-50'}`}>{label}</button>)}
    </div>
    <div className="min-h-0 flex-1 p-3 sm:p-6"><canvas ref={canvas} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className="h-full w-full touch-none rounded-2xl bg-white shadow-sm"/></div>
  </div>
}

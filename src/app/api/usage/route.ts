import { NextResponse } from 'next/server'
import { getUsageStats } from '@/server/usage'

export async function GET() {
  try {
    const stats = getUsageStats()
    
    // Also fetch memory stats from ombre brain
    let memoryStats = { total: 0, pinned: 0, domains: {} as Record<string, number> }
    try {
      const brainBase = process.env.BRAIN_BASE_URL || ''
      if (brainBase) {
        const res = await fetch(`${brainBase}/api/pulse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const pulse = await res.json()
        if (pulse.buckets) {
          memoryStats.total = pulse.buckets.length
          memoryStats.pinned = pulse.buckets.filter((b: any) => b.pinned).length
          pulse.buckets.forEach((b: any) => {
            const d = b.domain || 'general'
            memoryStats.domains[d] = (memoryStats.domains[d] || 0) + 1
          })
        }
      }
    } catch {}

    return NextResponse.json({ ...stats, memoryStats })
  } catch (err) {
    console.error('Usage stats error:', err)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}

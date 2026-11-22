import { NextRequest, NextResponse } from 'next/server'
import { birthNurseryChild, executeNurseryCommand, executeNurseryMama, readNurseryHealth, readNurseryStatus } from '@/server/nursery'
import { readNurseryEvents } from '@/server/nursery-events'

export const dynamic = 'force-dynamic'

const errorResponse = (error: unknown) => NextResponse.json(
  { error: error instanceof Error ? error.message : 'Nursery 暂时没有醒来' },
  { status: 503, headers: { 'Cache-Control': 'no-store' } },
)

export async function GET(request: NextRequest) {
  try {
    const view = request.nextUrl.searchParams.get('view') || 'status'
    const command = view === 'album' || view === 'log' || view === 'help' || view === 'letters' ? view : 'status'
    const [status, health] = await Promise.all([
      command === 'status' ? readNurseryStatus() : executeNurseryCommand(command),
      readNurseryHealth(),
    ])
    return NextResponse.json({ status, health, events: readNurseryEvents() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.action === 'birth') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (Array.from(name).length > 6) return NextResponse.json({ error: '名字最多六个字' }, { status: 400 })
      return NextResponse.json({ ok: true, result: await birthNurseryChild(name) })
    }
    if (body.action === 'mama') {
      const command = typeof body.command === 'string' ? body.command : ''
      const args = Array.isArray(body.args) ? body.args.filter((item: unknown) => typeof item === 'string').slice(0, 2) : []
      if (!command) return NextResponse.json({ error: '缺少照料动作' }, { status: 400 })
      return NextResponse.json(await executeNurseryMama(command, args))
    }
    if (body.action === 'name') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || Array.from(name).length > 6) return NextResponse.json({ error: '名字需要一到六个字' }, { status: 400 })
      return NextResponse.json({ ok: true, result: await executeNurseryCommand(`name ${name}`) })
    }
    return NextResponse.json({ error: '未知 Nursery 操作' }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}

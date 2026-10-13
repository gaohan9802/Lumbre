import { NextRequest, NextResponse } from 'next/server'
import { deleteEnergyEntry, readEnergyDashboard, saveBodyMeasurement, saveEnergyEntry, saveEnergyProfile } from '@/server/energy-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams
    return NextResponse.json(readEnergyDashboard(search.get('date') || undefined, Number(search.get('days')) || 7))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'energy_read_failed' }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'profile') return NextResponse.json({ ok: true, profile: saveEnergyProfile(body.profile || {}) })
    if (body.action === 'measurement') return NextResponse.json({ ok: true, measurement: saveBodyMeasurement(body.measurement || {}, 'fire') })
    if (body.action === 'entry') return NextResponse.json({ ok: true, entry: saveEnergyEntry(body.entry || {}, 'fire') })
    if (body.action === 'delete') return NextResponse.json({ ok: deleteEnergyEntry(String(body.id || '')) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'energy_write_failed' }, { status: 400 })
  }
}

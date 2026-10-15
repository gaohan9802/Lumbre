import { NextRequest, NextResponse } from 'next/server'
import { clearCompletedGroceryItems, deleteEnergyEntry, deleteEnergyGoal, deleteGroceryItem, deletePantryItem, readEnergyDashboard, saveBodyMeasurement, saveEnergyEntry, saveEnergyGoal, saveEnergyProfile, saveGroceryItem, savePantryItem } from '@/server/energy-store'

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
    if (body.action === 'pantry') return NextResponse.json({ ok: true, item: savePantryItem(body.item || {}, 'fire') })
    if (body.action === 'delete_pantry') return NextResponse.json({ ok: deletePantryItem(String(body.id || '')) })
    if (body.action === 'grocery') return NextResponse.json({ ok: true, item: saveGroceryItem(body.item || {}, 'fire') })
    if (body.action === 'delete_grocery') return NextResponse.json({ ok: deleteGroceryItem(String(body.id || '')) })
    if (body.action === 'clear_completed_groceries') return NextResponse.json({ ok: true, removed: clearCompletedGroceryItems() })
    if (body.action === 'goal') return NextResponse.json({ ok: true, goal: saveEnergyGoal(body.goal || {}, 'fire') })
    if (body.action === 'delete_goal') return NextResponse.json({ ok: deleteEnergyGoal(String(body.id || '')) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'energy_write_failed' }, { status: 400 })
  }
}

export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
export async function GET() { return NextResponse.json({ status: 'idle' }) }
export async function POST() { return NextResponse.json({ ok: true }) }

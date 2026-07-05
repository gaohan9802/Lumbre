import { NextRequest } from 'next/server'
import { proxyBrainGet } from '../../_helpers'
export const GET = (req: NextRequest) => proxyBrainGet(req, '/api/import/patterns')

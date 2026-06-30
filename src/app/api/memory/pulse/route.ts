import { NextRequest } from 'next/server'
import { proxyBrain } from '../../_helpers'
export const POST = (req: NextRequest) => proxyBrain(req, '/api/buckets')

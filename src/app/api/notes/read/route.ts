import { NextRequest } from 'next/server'
import { proxy } from '../../_helpers'
export const POST = (req: NextRequest) => proxy(req, '/notes/read')

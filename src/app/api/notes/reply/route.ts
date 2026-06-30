import { NextRequest } from 'next/server'
import { proxyDiary } from '../../_helpers'
export const POST = (req: NextRequest) => proxyDiary(req, '/api/notes/reply')

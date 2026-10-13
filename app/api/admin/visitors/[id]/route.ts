import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { getVisitor } from '@/modules/chat/lib/visitors'
import { clientVisitor } from '@/modules/chat/lib/serialise'
import { PERM_VIEW } from '@/modules/chat/lib/constants'

type Params = { params: Promise<{ id: string }> }

// One visitor in full: the page they are on, the trail behind them, the basket.
export async function GET(_request: Request, { params }: Params) {
  const auth = await requirePermission(PERM_VIEW)
  if ('response' in auth) return auth.response
  const { id } = await params
  const visitor = await getVisitor(id)
  if (!visitor) return errorResponse('That visitor has left and taken their trail with them.', 404)
  return NextResponse.json({ visitor: clientVisitor(visitor) }, { headers: { 'Cache-Control': 'no-store' } })
}

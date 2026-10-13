import { NextRequest, NextResponse } from 'next/server'
import { listConversations, totalUnread } from '@/modules/chat/lib/db'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { clientConversation } from '@/modules/chat/lib/serialise'
import { PERM_VIEW } from '@/modules/chat/lib/constants'

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERM_VIEW)
  if ('response' in auth) return auth.response
  const status = request.nextUrl.searchParams.get('status') === 'closed' ? 'closed' : 'open'
  const [conversations, unread] = await Promise.all([listConversations(status), totalUnread()])
  return NextResponse.json(
    { conversations: conversations.map(clientConversation), unread },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

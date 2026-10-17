import { NextRequest, NextResponse } from 'next/server'
import { listConversations, totalUnread } from '@/modules/chat/lib/db'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { clientConversation } from '@/modules/chat/lib/serialise'
import { getChatSettings } from '@/modules/chat/lib/settings'
import { PERM_VIEW } from '@/modules/chat/lib/constants'

export async function GET(request: NextRequest) {
  const auth = await requirePermission(PERM_VIEW)
  if ('response' in auth) return auth.response
  const status = request.nextUrl.searchParams.get('status') === 'closed' ? 'closed' : 'open'
  const [conversations, unread, settings] = await Promise.all([listConversations(status), totalUnread(), getChatSettings()])
  // The Online/Offline switch rides along, so a colleague flipping it elsewhere
  // shows here within one poll instead of needing a request of its own.
  return NextResponse.json(
    { conversations: conversations.map(clientConversation), unread, online: settings.online },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

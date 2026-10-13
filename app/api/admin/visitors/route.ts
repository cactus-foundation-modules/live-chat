import { NextResponse } from 'next/server'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { getChatSettings } from '@/modules/chat/lib/settings'
import { getConsentState } from '@/modules/chat/lib/consent'
import { listOnlineVisitors } from '@/modules/chat/lib/visitors'
import { clientListedVisitor } from '@/modules/chat/lib/serialise'
import { PERM_VIEW } from '@/modules/chat/lib/constants'

// Who is on the site right now: every visitor who agreed to the Live chat cookie
// category and checked in within the last minute and a half, whether or not
// they have said anything to us.
export async function GET() {
  const auth = await requirePermission(PERM_VIEW)
  if ('response' in auth) return auth.response
  const [settings, consent] = await Promise.all([getChatSettings(), getConsentState()])
  // Why the list might be empty, so the admin is told rather than left wondering.
  const reason = !settings.trackVisitors ? 'off' : consent.gate === 'none' ? 'no-category' : null
  const visitors = reason ? [] : await listOnlineVisitors().catch(() => [])
  return NextResponse.json(
    { visitors: visitors.map(clientListedVisitor), reason },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

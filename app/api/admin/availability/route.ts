import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { getChatSettings, setChatOnline } from '@/modules/chat/lib/settings'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { PERM_REPLY } from '@/modules/chat/lib/constants'
import { tellWaitingVisitorsWeAreOffline } from '@/modules/chat/lib/offline-notice'

// The Online/Offline switch on the inbox and the admin bubble. Site-wide: a
// visitor cannot tell one colleague from another.

export async function GET() {
  const auth = await requirePermission(PERM_REPLY)
  if ('response' in auth) return auth.response
  return NextResponse.json({ online: (await getChatSettings()).online }, { headers: { 'Cache-Control': 'no-store' } })
}

const Body = z.object({ online: z.boolean() })

export async function PUT(request: NextRequest) {
  const auth = await requirePermission(PERM_REPLY)
  if ('response' in auth) return auth.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('That did not look like online or offline.')
  const offlineSince = await setChatOnline(parsed.data.online)
  // Visitors left waiting on a reply hear now that it is not coming tonight,
  // rather than only when they next write.
  if (offlineSince) {
    after(async () => {
      try {
        await tellWaitingVisitorsWeAreOffline({ ...(await getChatSettings()), online: false, offlineSince })
      } catch (err) {
        console.error('[chat] could not tell waiting visitors we are offline', err)
      }
    })
  }
  return NextResponse.json({ ok: true, online: parsed.data.online })
}

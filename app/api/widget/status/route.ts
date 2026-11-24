import { NextResponse } from 'next/server'
import { getChatSettings } from '@/modules/chat/lib/settings'
import { visitorFacingOnline } from '@/modules/chat/lib/responder'

// Is anybody answering? The widget asks when it opens, so a page served from a
// cache a few minutes ago still tells the truth by the time somebody types.
// Somebody is answering when the switch is on, or another module is answering
// visitors (lib/responder.ts); this ask carries no claim, so not which visitor.
export async function GET() {
  const settings = await getChatSettings()
  return NextResponse.json(
    { online: await visitorFacingOnline(settings.online, null), label: settings.awayLabel, message: settings.awayMessage },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

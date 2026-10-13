import { NextResponse } from 'next/server'
import { getChatSettings } from '@/modules/chat/lib/settings'

// Is anybody answering? The widget asks when it opens, so a page served from a
// cache a few minutes ago still tells the truth by the time somebody types.
export async function GET() {
  const settings = await getChatSettings()
  return NextResponse.json(
    { online: settings.online, label: settings.awayLabel, message: settings.awayMessage },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

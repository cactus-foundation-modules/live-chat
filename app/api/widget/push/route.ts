import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { getOrCreateVapidKeys } from '@/lib/push/store'
import { isAllowedPushEndpoint } from '@/lib/push/web-push'
import { setPushSubscription } from '@/modules/chat/lib/db'
import { visitorConversation } from '@/modules/chat/lib/visitor'

// Browser notifications for a visitor, offered once they have sent a message.
// The site's own signing pair is used, the same one admin alerts use.

export async function GET(request: NextRequest) {
  // Only somebody with a chat may ask, so a stranger cannot make the site mint
  // a key pair by hitting this.
  if (!await visitorConversation(request)) return errorResponse('Chat not found', 404)
  const keys = await getOrCreateVapidKeys()
  return NextResponse.json({ publicKey: keys.publicKey }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const conversation = await visitorConversation(request)
  if (!conversation) return errorResponse('Chat not found', 404)
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
  const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : ''
  if (!endpoint || !p256dh || !auth || p256dh.length > 200 || auth.length > 100 || !isAllowedPushEndpoint(endpoint)) {
    return errorResponse('That browser subscription is not one we can use.')
  }
  await setPushSubscription(conversation.id, { endpoint, keys: { p256dh, auth } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const conversation = await visitorConversation(request)
  if (!conversation) return errorResponse('Chat not found', 404)
  await setPushSubscription(conversation.id, null)
  return NextResponse.json({ ok: true })
}

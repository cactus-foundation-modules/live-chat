import { after, NextRequest, NextResponse } from 'next/server'
import { getClientIp } from '@/lib/auth/rate-limit'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { errorResponse } from '@/lib/utils'
import { createConversation, deleteConversations, insertMessage } from '@/modules/chat/lib/db'
import { pushNewVisitor } from '@/modules/chat/lib/notify'
import { getChatSettings } from '@/modules/chat/lib/settings'
import { getConsentState, mayTrack } from '@/modules/chat/lib/consent'
import { hashIp, hashSecret, newConversationId, newSecret, visitorConversation } from '@/modules/chat/lib/visitor'
import {
  claimCartMessage,
  countVisitorsFromIp,
  createVisitor,
  deleteVisitor,
  getVisitorTrail,
  getVisitorTokenHash,
  linkConversationToVisitor,
  openChatWeStarted,
  openChatWithVisitor,
  pruneVisitors,
  recordCheckIn,
  releaseCartMessage,
  resolveCart,
  visitorFromRequest,
} from '@/modules/chat/lib/visitors'
import { cleanCartInput, cleanPath, cleanReferrer, cleanTitle, deviceFrom, extendTrail } from '@/modules/chat/lib/trail'

// A visitor's browser checking in: the page they are on, and their basket when
// it changed. Only for a visitor who said yes to the Live chat cookie category,
// checked here as well as in the browser. The answer carries the chat we have
// started with them, if we have, so the widget can show it.

const NEW_VISITORS_PER_HOUR = 30
const MAX_BODY_BYTES = 8 * 1024

const noStore = { 'Cache-Control': 'no-store' }

function ownHost(): string | null {
  const site = getSiteUrlOrNull()
  if (!site) return null
  try { return new URL(site).hostname } catch { return null }
}

export async function POST(request: NextRequest) {
  const [settings, consent] = await Promise.all([getChatSettings(), getConsentState()])
  if (!settings.enabled || !settings.trackVisitors || !mayTrack(request, consent.gate)) {
    // Somebody who withdrew consent in another tab still holds a claim: their
    // trail goes now, not a week from now.
    const claim = await visitorFromRequest(request).catch(() => null)
    if (claim) await deleteVisitor(claim.id)
    return NextResponse.json({ tracking: false }, { status: 403, headers: noStore })
  }

  const text = await request.text().catch(() => '')
  if (text.length > MAX_BODY_BYTES) return errorResponse('That is rather a lot.', 413)
  let input: Record<string, unknown>
  try { input = JSON.parse(text || '{}') as Record<string, unknown> } catch { return errorResponse('That could not be read.') }

  const path = cleanPath(input.path)
  if (!path) return errorResponse('That page could not be read.')
  const title = cleanTitle(input.title)
  const cartIn = cleanCartInput(input.cart)

  let claim = await visitorFromRequest(request)
  let newClaim: string | null = null
  if (!claim) {
    const ipHash = hashIp(await getClientIp(request))
    if (await countVisitorsFromIp(ipHash, new Date(Date.now() - 60 * 60 * 1000)) >= NEW_VISITORS_PER_HOUR) {
      return errorResponse('Too many visitors from here - please try again in a little while.', 429)
    }
    const id = newConversationId()
    const secret = newSecret()
    await createVisitor({
      id,
      tokenHash: hashSecret(secret),
      ipHash,
      device: deviceFrom(request.headers.get('user-agent')),
      referrer: cleanReferrer(input.referrer, ownHost()),
    })
    claim = { id, secret }
    newClaim = `${id}.${secret}`
    // Somebody arriving is as good a moment as any to forget whoever left a week
    // ago, and means a site with no cron secret still tidies up.
    const arrivedAt = { path, title, device: deviceFrom(request.headers.get('user-agent')) }
    after(async () => {
      await pruneVisitors().catch(() => 0)
      await pushNewVisitor(id, arrivedAt.device, arrivedAt.path, arrivedAt.title)
    })
  }

  const { trail, moved } = extendTrail(await getVisitorTrail(claim.id), { path, title, at: new Date().toISOString() })
  const cart = cartIn === undefined ? undefined : await resolveCart(cartIn)
  await recordCheckIn(claim.id, { path, title, trail, moved, cart })

  // A chat they started before they agreed to be listed joins up with them now.
  const conversation = await visitorConversation(request)
  if (conversation && !conversation.visitorId) await linkConversationToVisitor(conversation.id, claim.id)

  // Something just went in the basket: the owner's message, once per visitor,
  // while somebody is answering and they have no chat going.
  if (input.cartAdded === true && settings.cartMessageEnabled && settings.online && !conversation) {
    await sayHelloOverTheBasket(claim.id, path, settings.cartMessage)
  }

  const chatId = await openChatWeStarted(claim.id)
  return NextResponse.json(
    {
      tracking: true,
      claim: newClaim,
      // The widget makes the chat's claim itself, from the secret it already
      // holds: this never sends a secret, only which chat to claim with it.
      chat: chatId,
      online: settings.online,
    },
    { headers: noStore },
  )
}

const CART_MESSAGE_AUTHOR = 'Our team'

async function sayHelloOverTheBasket(visitorId: string, path: string, text: string): Promise<void> {
  if (await openChatWithVisitor(visitorId)) return
  if (!await claimCartMessage(visitorId)) return
  let conversationId: string | null = null
  try {
    const tokenHash = await getVisitorTokenHash(visitorId)
    if (!tokenHash) throw new Error('visitor has no secret')
    conversationId = newConversationId()
    await createConversation({ id: conversationId, tokenHash, name: null, email: null, pageUrl: path, ipHash: null, visitorId, startedBy: 'agent' })
    await insertMessage({ conversationId, sender: 'agent', authorName: CART_MESSAGE_AUTHOR, body: text })
  } catch (err) {
    // A chat that never got its message is not a chat; let the next add try again.
    if (conversationId) await deleteConversations([conversationId]).catch(() => 0)
    await releaseCartMessage(visitorId).catch(() => undefined)
    console.error('[chat] could not send the basket message', err)
  }
}

/** Forget me: the visitor withdrew consent, or ended their visit's trail. */
export async function DELETE(request: NextRequest) {
  const claim = await visitorFromRequest(request)
  if (claim) await deleteVisitor(claim.id)
  return NextResponse.json({ ok: true }, { headers: noStore })
}

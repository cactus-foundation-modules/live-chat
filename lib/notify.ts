import { clearAlert, upsertAlert } from '@/lib/notifications/alerts'
import { announceConversationArrived } from '@/lib/conversations/arrived'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { prisma } from '@/lib/db/prisma'
import { readVapidKeys } from '@/lib/push/store'
import { sendWebPush, type PushSubscriptionKeys } from '@/lib/push/web-push'
import { MODULE_NAME, PROVIDER_ID } from './constants'
import { getPushSubscription, setPushSubscription, totalUnread } from './db'

// Everything that happens after a message is saved, none of which the person
// who sent it should wait for. Callers hand these to after(). None of them
// throws: the message is already safe, and that is the part that matters.

const ALERT_KEY = 'chat:unread'

/** One rolling bell entry while any chat is waiting on a reply. Core pushes it
 *  to admins who switched on desktop alerts. */
export async function syncAgentAlert(): Promise<void> {
  try {
    const n = await totalUnread()
    if (n > 0) {
      await upsertAlert({
        type: 'message',
        dedupeKey: ALERT_KEY,
        title: `${n} live chat${n === 1 ? '' : 's'} waiting for a reply`,
        link: `/inbox?tab=${MODULE_NAME}`,
      })
    } else {
      await clearAlert(ALERT_KEY)
    }
  } catch (err) {
    console.error('[chat] could not update the bell', err)
  }
}

/** Tells anything keeping a copy of conversations (the Unified Inbox) that this
 *  one has something new, so it lands there now rather than on the next sync. */
export async function announce(conversationId: string): Promise<void> {
  await announceConversationArrived({ moduleName: MODULE_NAME, providerId: PROVIDER_ID, conversationId })
}

function isSubscription(value: unknown): value is PushSubscriptionKeys {
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  return !!v && typeof v.endpoint === 'string' && typeof v.keys?.p256dh === 'string' && typeof v.keys?.auth === 'string'
}

/** A browser notification for the visitor, when they said yes to them. */
export async function pushToVisitor(conversationId: string, authorName: string | null, text: string): Promise<void> {
  try {
    const subscription = await getPushSubscription(conversationId)
    if (!isSubscription(subscription)) return
    const keys = await readVapidKeys()
    const site = getSiteUrlOrNull()
    if (!keys || !site || !site.startsWith('https://')) return
    const config = await prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { siteName: true } })
    const payload = JSON.stringify({
      title: authorName ? `${authorName} replied` : `New message from ${config?.siteName || 'us'}`,
      body: text.slice(0, 180),
      tag: `chat-${conversationId}`,
      href: '/?chat=open',
    })
    const outcome = await sendWebPush(subscription, payload, { keys, subject: site }, { ttlSeconds: 24 * 60 * 60, urgency: 'high', timeoutMs: 5_000 })
    if (outcome.gone) await setPushSubscription(conversationId, null)
  } catch (err) {
    console.error('[chat] could not notify the visitor', err)
  }
}

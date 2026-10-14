import { createConversation, deleteConversations, insertMessage } from './db'
import type { ChatSettings } from './settings'
import { newConversationId } from './visitor'
import {
  claimCartMessage,
  claimWelcomeMessage,
  clearCartAdded,
  getAutoMessageTimes,
  getVisitorTokenHash,
  markCartAdded,
  openChatWithVisitor,
  releaseCartMessage,
  releaseWelcomeMessage,
} from './visitors'

// The messages the owner has asked us to send first: a welcome to somebody who
// has been here a while without a word, and a nudge after something goes in
// the basket. Each goes once per visitor, while somebody is answering and the
// visitor has no chat going. Nothing here runs on a timer of its own: every
// visitor check-in asks "is anything due?", and when something is waiting the
// answer says how long until it is, so the widget checks in again right then.

const AUTHOR = 'Our team'
/** A basket message this long overdue (the visitor wandered off) is not sent at all. */
const CART_STALE_MS = 10 * 60 * 1000
const MIN_RECHECK_MS = 1000

type Kind = { claim: (id: string) => Promise<boolean>; release: (id: string) => Promise<void>; label: string }

const WELCOME: Kind = { claim: claimWelcomeMessage, release: releaseWelcomeMessage, label: 'welcome' }
const CART: Kind = { claim: claimCartMessage, release: releaseCartMessage, label: 'basket' }

type Outcome = 'sent' | 'chat-going' | 'failed'

async function sendOnce(kind: Kind, visitorId: string, path: string, text: string): Promise<Outcome> {
  if (await openChatWithVisitor(visitorId)) return 'chat-going'
  if (!await kind.claim(visitorId)) return 'chat-going'
  let conversationId: string | null = null
  try {
    const tokenHash = await getVisitorTokenHash(visitorId)
    if (!tokenHash) throw new Error('visitor has no secret')
    conversationId = newConversationId()
    await createConversation({ id: conversationId, tokenHash, name: null, email: null, pageUrl: path, ipHash: null, visitorId, startedBy: 'agent' })
    await insertMessage({ conversationId, sender: 'agent', authorName: AUTHOR, body: text })
    return 'sent'
  } catch (err) {
    // A chat that never got its message is not a chat; let the next check-in try again.
    if (conversationId) await deleteConversations([conversationId]).catch(() => 0)
    await kind.release(visitorId).catch(() => undefined)
    console.error(`[chat] could not send the ${kind.label} message`, err)
    return 'failed'
  }
}

/** Sends whatever has fallen due for this visitor. Returns how many milliseconds
 *  until the next thing falls due, or undefined when nothing is waiting. */
export async function runAutoMessages(
  visitorId: string,
  path: string,
  settings: ChatSettings,
  cartAdded: boolean,
): Promise<number | undefined> {
  if (!settings.online) return undefined
  if (cartAdded && settings.cartMessageEnabled) await markCartAdded(visitorId)
  const times = await getAutoMessageTimes(visitorId)
  if (!times) return undefined

  const waits: number[] = []

  if (settings.welcomeEnabled && !times.welcomeSent) {
    const wait = settings.welcomeDelaySeconds * 1000 - times.sinceFirstSeenMs
    if (wait > 0) waits.push(wait)
    else if (await sendOnce(WELCOME, visitorId, path, settings.welcomeMessage) === 'sent') {
      // They have a chat now, so a basket message on top would be a second hello.
      await clearCartAdded(visitorId)
      return undefined
    }
  }

  if (settings.cartMessageEnabled && times.sinceCartAddedMs !== null) {
    const delayMs = settings.cartMessageDelaySeconds * 1000
    const wait = delayMs - times.sinceCartAddedMs
    if (wait > 0) waits.push(wait)
    else if (times.sinceCartAddedMs > delayMs + CART_STALE_MS) await clearCartAdded(visitorId)
    else {
      const outcome = await sendOnce(CART, visitorId, path, settings.cartMessage)
      // Sent, or they are already talking to us: either way nothing more is owed.
      if (outcome !== 'failed') await clearCartAdded(visitorId)
    }
  }

  return waits.length > 0 ? Math.max(MIN_RECHECK_MS, Math.min(...waits)) : undefined
}

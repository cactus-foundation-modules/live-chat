import { z } from 'zod'
import { RESPONDER_AUTHOR_PREFIX } from './constants'

// `chat.responder` - another module may answer chats.
//
// Live chat is answered by colleagues. A module that has its own way of
// answering (an automatic assistant, an out-of-hours service, a queue that
// hands chats round) publishes a responder here: one object of async
// functions, offered each visitor message and told about the things around it
// - a colleague replying, the Online switch changing.
//
// The safety story is the same as twilio.inbound-call-handler's. Each call has
// two seconds; a responder that throws, takes longer or answers with something
// that does not parse is taken to have said no, and Live chat does exactly
// what it would have done with no responder installed. A third party having a
// bad day must never cost a visitor their reply.
//
// This file names no module. A site with no responder pays one registry lookup
// where a responder could be asked, and nothing else.
//
// SERVER ONLY. The manifest entry that publishes a responder must set
// `serverOnly: true`. The responder's own writes go through lib/responder-api.ts.

export const RESPONDER_POINT = 'chat.responder'

/** How long one call to a responder may take before it is taken as a no. */
export const RESPONDER_TIMEOUT_MS = 2_000

/** A visitor's message, just saved. */
export type VisitorMessageOffer = {
  conversationId: string
  /** chat_messages.id of the message. */
  messageId: number
  /** The visitor row (who is on the site) the chat belongs to, when they agreed
   *  to be listed; null otherwise. */
  visitorId: string | null
  /** The real Online switch. */
  online: boolean
  /** True when this message started the chat. */
  newConversation: boolean
}

export type AnsweringContext = {
  /** The real Online switch. A responder that answers alongside colleagues
   *  (only while they are online, or only when told to go first) reads it here. */
  online: boolean
  /** The visitor being shown the chat, when we know who they are; null when we
   *  do not (a page render, or a status check with no claim). */
  visitorId: string | null
}

export type ColleagueRepliedContext = {
  conversationId: string
  /** The colleague's user id. */
  userId: string
}

export type OnlineChangedContext = {
  online: boolean
  /** The chats still open when the switch moved, newest first (up to 500). */
  openConversationIds: string[]
}

export type ResponderContract = {
  /** Stored in chat_messages.author_user_id on every message the responder
   *  writes. Must start with "module:" (e.g. "module:some-module"), so it can
   *  never collide with a real user id. */
  authorId: string
  /** Offered every visitor message right after it is saved, inside the
   *  request. Return true to take the conversation's reply; the responder then
   *  does its slow work itself (e.g. in next/server `after()`). False, a throw
   *  or a timeout means not taken, and the ordinary flow runs: the chat counts
   *  as waiting for a colleague, and the offline reply goes if it is owed. */
  offerVisitorMessage(ctx: VisitorMessageOffer): Promise<boolean>
  /** Whether the responder is answering visitors right now, and under what
   *  name. While the switch is off it decides the visitor-facing online state
   *  and lets the welcome and basket messages go; whenever it answers (switch
   *  on or off) those messages go under its name and author id. null = not
   *  answering. Asked often: with the switch off on every page render with the
   *  bubble, every visitor check-in and every poll of an open chat window, and
   *  with it on at every visitor check-in. Keep it cheap (an in-memory answer,
   *  or one small read). */
  answeringAs(ctx: AnsweringContext): Promise<{ authorName: string } | null>
  /** A colleague has replied in this conversation - from the admin, the bubble
   *  on the site, a hello sent first from the visitor list, or the Unified
   *  Inbox. Never for the responder's own messages or the automatic ones. */
  colleagueReplied(ctx: ColleagueRepliedContext): Promise<void>
  /** The Online switch changed. Return `covered: true` when the responder will
   *  look after visitors left mid-chat, so Live chat skips its own "we have had
   *  to step away" message to them. */
  onlineChanged(ctx: OnlineChangedContext): Promise<{ covered: boolean }>
  /** A short label shown beside the responder's messages, or null for none.
   *  Asked once per batch of messages handed to a browser, so keep it cheap. */
  messageLabel(): Promise<string | null>
}

/** What Live chat hands out when the visitor-facing state is asked for once
 *  and used twice (presence: the online state and the automatic messages). */
export type VisitorAnswering = {
  /** What the visitor is told: the switch, or the responder answering. */
  online: boolean
  /** Set when a responder is answering this visitor, switch on or off. */
  responder: { authorId: string; authorName: string } | null
}

const AuthorId = z.string().max(100).regex(new RegExp(`^${RESPONDER_AUTHOR_PREFIX}[A-Za-z0-9][A-Za-z0-9._-]*$`))
const Taken = z.boolean()
const Answering = z.object({ authorName: z.string().trim().min(1).max(80) }).nullable()
const Covered = z.object({ covered: z.boolean() })
const Label = z.string().trim().min(1).max(40).nullable()

const METHODS = ['offerVisitorMessage', 'answeringAs', 'colleagueReplied', 'onlineChanged', 'messageLabel'] as const

/** Duck-typed: the registry is typed loosely and a provider cannot share our
 *  types at runtime, so the shape is checked rather than trusted. */
export function isResponder(value: unknown): value is ResponderContract {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  if (!AuthorId.safeParse(entry.authorId).success) return false
  return METHODS.every((name) => typeof entry[name] === 'function')
}

/** The first responder registered, or null. Never throws. */
export async function getResponder(): Promise<ResponderContract | null> {
  try {
    // Dynamic on purpose, as twilio's inbound-call-handlers.ts explains: the
    // generated registry imports module code, and a static edge back to it can
    // close an import cycle. The server map, because a responder is server-only
    // by contract.
    const { moduleServerExtensionPointComponents } = await import('@/lib/modules/extension-points.server')
    const entries: Record<string, unknown> = moduleServerExtensionPointComponents[RESPONDER_POINT] ?? {}
    for (const entry of Object.values(entries)) {
      if (isResponder(entry)) return entry
    }
  } catch (err) {
    console.error('[chat] could not read the responder registry', err)
  }
  return null
}

/** One call to a responder, with the time limit, the catch and the parse. */
async function ask<T>(what: string, call: () => Promise<unknown>, parse: (value: unknown) => T | undefined, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), RESPONDER_TIMEOUT_MS) })
  try {
    const answer = await Promise.race([Promise.resolve().then(call), timeout])
    if (answer === 'timeout') {
      console.error(`[chat] the responder took too long to answer ${what}; carrying on without it`)
      return fallback
    }
    const parsed = parse(answer)
    if (parsed === undefined) {
      console.error(`[chat] the responder gave an answer to ${what} that could not be read; carrying on without it`)
      return fallback
    }
    return parsed
  } catch (err) {
    console.error(`[chat] the responder failed on ${what}; carrying on without it`, err)
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function parsedWith<T>(schema: z.ZodType<T>): (value: unknown) => T | undefined {
  return (value) => {
    const result = schema.safeParse(value)
    return result.success ? result.data : undefined
  }
}

// --- the five calls, each safe to make -------------------------------------

export function offerVisitorMessage(responder: ResponderContract, ctx: VisitorMessageOffer): Promise<boolean> {
  return ask('a visitor message', () => responder.offerVisitorMessage(ctx), parsedWith(Taken), false)
}

export function answeringAs(responder: ResponderContract, ctx: AnsweringContext): Promise<{ authorName: string } | null> {
  return ask('whether it is answering', () => responder.answeringAs(ctx), parsedWith(Answering), null)
}

export async function colleagueReplied(responder: ResponderContract, ctx: ColleagueRepliedContext): Promise<void> {
  await ask('a colleague replying', () => responder.colleagueReplied(ctx), () => null, null)
}

export function onlineChanged(responder: ResponderContract, ctx: OnlineChangedContext): Promise<{ covered: boolean }> {
  return ask('the Online switch changing', () => responder.onlineChanged(ctx), parsedWith(Covered), { covered: false })
}

export function messageLabel(responder: ResponderContract): Promise<string | null> {
  return ask('its message label', () => responder.messageLabel(), parsedWith(Label), null)
}

// --- what the rest of the module asks --------------------------------------

/**
 * Whether anybody is answering this visitor, and whether that is a responder:
 * online when the switch is on or a responder is answering them. With no
 * responder this is the switch, exactly, and no responder is asked.
 */
export async function visitorAnswering(online: boolean, visitorId: string | null): Promise<VisitorAnswering> {
  const responder = await getResponder()
  if (!responder) return { online, responder: null }
  const as = await answeringAs(responder, { online, visitorId })
  return { online: online || as !== null, responder: as ? { authorId: responder.authorId, authorName: as.authorName } : null }
}

/** Just the visitor-facing online state. The switch being on settles it
 *  without asking anybody. */
export async function visitorFacingOnline(online: boolean, visitorId: string | null): Promise<boolean> {
  if (online) return true
  return (await visitorAnswering(online, visitorId)).online
}

/** Tells the responder, if there is one, that a colleague replied. Never throws. */
export async function tellResponderColleagueReplied(ctx: ColleagueRepliedContext): Promise<void> {
  const responder = await getResponder()
  if (responder) await colleagueReplied(responder, ctx)
}

/** Whether a message was written by another module answering chats. */
export function isResponderAuthor(authorUserId: string | null | undefined): boolean {
  return typeof authorUserId === 'string' && authorUserId.startsWith(RESPONDER_AUTHOR_PREFIX)
}

/**
 * The label for the responder's messages among these, keyed by its author id,
 * or null when none of them is the responder's (or it has no label). Asks the
 * registry only when a message carries a module author, and the responder at
 * most once.
 */
export async function responderLabelFor(messages: ReadonlyArray<{ authorUserId: string | null }>): Promise<{ authorId: string; label: string } | null> {
  if (!messages.some((m) => isResponderAuthor(m.authorUserId))) return null
  const responder = await getResponder()
  if (!responder || !messages.some((m) => m.authorUserId === responder.authorId)) return null
  const label = await messageLabel(responder)
  return label ? { authorId: responder.authorId, label } : null
}

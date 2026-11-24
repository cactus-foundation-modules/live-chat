import { MAX_MESSAGE_CHARS, RESPONDER_AUTHOR_PREFIX } from './constants'
import {
  addUnreadForAgents,
  clearAgentTyping,
  getAttachment,
  getConversation,
  listMessages,
  stampTyping,
  type ChatAttachment,
  type ChatMessage,
} from './db'
import { loadFile } from './attachments'
import { announce, syncAgentAlert } from './notify'
import { ChatEndedError, closeChatAsAgent, postAgentMessage } from './reply'
import { filesProblem } from './text'
import { getVisitor } from './visitors'
import { later } from './later'
import { clientVisitor, type ClientVisitor } from './serialise'

// What a module answering chats (lib/responder.ts) may do in a chat, and read
// of one. The one door: a responder module declares `requiresModules: chat`
// and imports this file; nothing else in Live chat is promised to stay put.
//
// Every write here goes the way the same thing done by a colleague goes - the
// same save, the same push to the visitor's browser, the same bell and the
// same word to the Unified Inbox - minus "a colleague replied", which is never
// said of a module.
//
// SERVER ONLY.

export { ChatEndedError }

/** A file the responder sends with a message. */
export type ResponderFile = { filename: string; contentType: string; content: Uint8Array }

/** One message of a chat, as a responder reads it. */
export type ResponderMessage = {
  id: number
  sender: 'visitor' | 'agent' | 'system'
  /** A colleague's user id, a module's "module:<name>", or null (the visitor,
   *  the automatic messages, system lines). */
  authorId: string | null
  authorName: string | null
  body: string
  createdAt: Date
  /** Read the bytes with readResponderAttachment(). */
  attachments: ChatAttachment[]
}

export type ResponderConversation = {
  id: string
  status: 'open' | 'closed'
  startedBy: 'visitor' | 'agent'
  createdAt: Date
  lastMessageAt: Date
  /** The page the chat was started on, as a path. */
  pageUrl: string | null
  /** What the visitor told us about themselves, each null until they do. */
  visitorName: string | null
  visitorEmail: string | null
  visitorPhone: string | null
  /** The visitor row the chat belongs to, when they agreed to be listed. */
  visitorId: string | null
  /** Whether a colleague has been asked for and not read it yet. */
  unreadForAgents: number
}

export type ResponderChat = {
  conversation: ResponderConversation
  /** Every message, oldest first (up to 500). */
  messages: ResponderMessage[]
  /** Where they are, where they have been and what is in their basket, exactly
   *  as the visitor list shows it; null when they are not on the visitor list. */
  visitor: ClientVisitor | null
}

function toResponderMessage(m: ChatMessage): ResponderMessage {
  return { id: m.id, sender: m.sender, authorId: m.authorUserId, authorName: m.authorName, body: m.body, createdAt: m.createdAt, attachments: m.attachments }
}

function checkedAuthorId(authorId: string): string {
  if (!authorId.startsWith(RESPONDER_AUTHOR_PREFIX) || authorId.length > 100) {
    throw new Error(`A responder's author id must start with "${RESPONDER_AUTHOR_PREFIX}".`)
  }
  return authorId
}

/**
 * Posts a message into the chat as the responder. Throws ChatEndedError on an
 * ended chat, and a plain Error for a missing chat, an empty message, a bad
 * author id or files Live chat would refuse from a colleague. Leaves the
 * unread count alone, so a chat handed to a colleague stays waiting for one.
 */
export async function postResponderMessage(input: {
  conversationId: string
  /** The responder's own authorId ("module:<name>"). Messages carrying the
   *  registered responder's id are the ones that get its label. */
  authorId: string
  /** The name the visitor sees on it. */
  authorName: string
  body: string
  attachments?: ResponderFile[]
}): Promise<ResponderMessage> {
  const authorUserId = checkedAuthorId(input.authorId)
  const body = input.body.trim().slice(0, MAX_MESSAGE_CHARS)
  const files = (input.attachments ?? []).map((f) => new File([new Uint8Array(f.content)], f.filename, { type: f.contentType }))
  if (!body && files.length === 0) throw new Error('There is nothing to send.')
  const problem = filesProblem(files)
  if (problem) throw new Error(problem)
  const authorName = input.authorName.trim().slice(0, 80) || null
  const saved = await postAgentMessage(input.conversationId, { authorUserId, authorName, body, files, markRead: false })
  return toResponderMessage(saved)
}

/** Shows "<name> is typing…" to the visitor, or stops it with null. One call
 *  lasts about seven seconds (the window a colleague's typing lasts), so call
 *  again every few seconds while the reply is being written. A message posted
 *  clears it by itself. Only an open chat. */
export async function setResponderTyping(conversationId: string, name: string | null): Promise<void> {
  if (name === null) await clearAgentTyping(conversationId)
  else await stampTyping(conversationId, 'agent', name.trim().slice(0, 80))
}

/**
 * Hands the chat to a colleague: it counts as waiting for a reply, so it shows
 * unread in the admin list (which chimes, as it does for any chat newly
 * waiting), lights the bell (which buzzes anybody with desktop alerts on) and
 * shows as unread in the Unified Inbox. It stays waiting until a colleague
 * reads it; the responder's own later messages do not clear it. Returns false
 * when the chat is missing or has ended.
 */
export async function askForColleague(conversationId: string): Promise<boolean> {
  const asked = await addUnreadForAgents(conversationId)
  if (asked) {
    later(async () => {
      await syncAgentAlert()
      await announce(conversationId)
    })
  }
  return asked
}

/** Ends the chat as a colleague pressing End chat does: a line saying who ended
 *  it ("<name> ended the chat.", "We ended the chat." without one), closed for
 *  good. Returns false when the chat is missing or had already ended. */
export async function endConversationAsAgent(conversationId: string, name: string | null = null): Promise<boolean> {
  const conversation = await getConversation(conversationId)
  if (!conversation || conversation.status === 'closed') return false
  await closeChatAsAgent(conversationId, name?.trim() || null)
  return true
}

/** The chat, every message in it and, when the visitor is listed, where they
 *  are and what is in their basket. Null for a chat that does not exist. */
export async function getConversationForResponder(conversationId: string): Promise<ResponderChat | null> {
  const conversation = await getConversation(conversationId)
  if (!conversation) return null
  const [messages, visitor] = await Promise.all([
    listMessages(conversationId),
    conversation.visitorId ? getVisitor(conversation.visitorId).catch(() => null) : Promise.resolve(null),
  ])
  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      startedBy: conversation.startedBy,
      createdAt: conversation.createdAt,
      lastMessageAt: conversation.lastMessageAt,
      pageUrl: conversation.pageUrl,
      visitorName: conversation.visitorName,
      visitorEmail: conversation.visitorEmail,
      visitorPhone: conversation.visitorPhone,
      visitorId: conversation.visitorId,
      unreadForAgents: conversation.unreadForAgents,
    },
    messages: messages.map(toResponderMessage),
    visitor: visitor ? clientVisitor(visitor) : null,
  }
}

/** The bytes of one attachment in this chat, from the site's private storage.
 *  Null when there is no such attachment in this chat. Throws when storage
 *  cannot be reached. */
export async function readResponderAttachment(conversationId: string, attachmentId: string): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
  if (!/^[a-f0-9]{32}$/.test(attachmentId)) return null
  const attachment = await getAttachment(attachmentId)
  if (!attachment || attachment.conversationId !== conversationId) return null
  return { filename: attachment.filename, contentType: attachment.contentType, content: await loadFile(attachment) }
}

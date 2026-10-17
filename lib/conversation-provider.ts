import type {
  ConversationListOptions,
  ConversationListPage,
  ConversationMessage,
  ConversationProvider,
  ConversationSummary,
  ConversationThread,
} from '@/lib/conversations/types'
import { API_BASE, MAX_MESSAGE_CHARS, MODULE_NAME } from './constants'
import {
  getConversation,
  listConversationPage,
  listConversationsByEmails,
  listMessages,
  markReadByAgents,
  type ChatConversation,
  type ChatMessage,
} from './db'
import { sendAgentReply } from './reply'
import { syncAgentAlert } from './notify'
import { linksToHtml } from './links'

// Live chats published as plain data, so the Unified Inbox (or anything else
// reading core.conversation-provider) can list them beside email and answer
// them. A reply sent from there arrives in the visitor's chat exactly like one
// typed in this module's own inbox.
//
// SERVER ONLY - the manifest entry sets serverOnly.

function toSummary(c: ChatConversation): ConversationSummary {
  return {
    id: c.id,
    channel: 'chat',
    subject: c.visitorName ? `Chat with ${c.visitorName}` : 'Live chat',
    preview: c.lastMessagePreview,
    participant: { name: c.visitorName, email: c.visitorEmail, phone: c.visitorPhone },
    lastMessageAt: c.lastMessageAt,
    contentAt: c.updatedAt > c.lastMessageAt ? c.updatedAt : c.lastMessageAt,
    unread: c.unreadForAgents > 0,
    status: c.status,
    href: `inbox?tab=${MODULE_NAME}&id=${c.id}`,
  }
}

function toMessage(m: ChatMessage): ConversationMessage {
  return {
    id: String(m.id),
    // A system line ("the visitor ended the chat") is our own remark, and must
    // never read as something the visitor was sent.
    direction: m.sender === 'visitor' ? 'in' : m.sender === 'agent' ? 'out' : 'note',
    authorName: m.sender === 'system' ? null : m.authorName,
    text: m.body,
    html: linksToHtml(m.body),
    sentAt: m.createdAt,
    attachments: m.attachments.map((a) => ({ filename: a.filename, url: `${API_BASE}/attachments/${a.id}`, contentType: a.contentType })),
  }
}

async function list(opts: ConversationListOptions): Promise<ConversationListPage> {
  const before = opts.cursor ? new Date(opts.cursor) : undefined
  const rows = await listConversationPage({
    since: opts.since,
    before: before && !Number.isNaN(before.getTime()) ? before : undefined,
    limit: opts.limit,
  })
  const last = rows[rows.length - 1]
  return {
    items: rows.map(toSummary),
    nextCursor: rows.length >= opts.limit && last ? last.lastMessageAt.toISOString() : undefined,
  }
}

async function thread(id: string): Promise<ConversationThread | null> {
  const conversation = await getConversation(id)
  if (!conversation) return null
  const messages = await listMessages(id)
  return { summary: toSummary(conversation), messages: messages.map(toMessage) }
}

async function send(id: string, body: { text: string; authorUserId: string }): Promise<void> {
  const conversation = await getConversation(id)
  if (!conversation) throw new Error('That chat could not be found.')
  const text = body.text.trim().slice(0, MAX_MESSAGE_CHARS)
  if (!text) throw new Error('There is nothing to send.')
  await sendAgentReply(id, body.authorUserId, text)
}

async function markRead(id: string): Promise<void> {
  await markReadByAgents(id)
  await syncAgentAlert()
}

async function byIdentity(identity: { emails: string[] }): Promise<ConversationSummary[]> {
  return (await listConversationsByEmails(identity.emails)).map(toSummary)
}

export const chatConversationProvider: ConversationProvider = {
  label: 'Live chat',
  channel: 'chat',
  capabilities: { reply: true, markRead: true, byIdentity: true, markdownLinks: true },
  list,
  thread,
  send,
  markRead,
  byIdentity,
}

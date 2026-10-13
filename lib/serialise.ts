import { API_BASE } from './constants'
import type { ChatConversation, ChatMessage } from './db'
import { attachmentSignature } from './visitor'

// What a browser is handed. The visitor's copy carries signed attachment links
// (they have no session to be checked against); the admin's copy does not need
// them, because the attachment route checks the admin's session instead.

export type ClientAttachment = { id: string; filename: string; contentType: string; sizeBytes: number; url: string }
export type ClientMessage = {
  id: number
  sender: 'visitor' | 'agent' | 'system'
  authorName: string | null
  body: string
  createdAt: string
  attachments: ClientAttachment[]
}
export type ClientConversation = {
  id: string
  visitorName: string | null
  visitorEmail: string | null
  status: 'open' | 'closed'
  pageUrl: string | null
  unread: number
  lastMessageAt: string
  preview: string | null
  notifications: boolean
}

export function clientMessage(m: ChatMessage, forVisitor: boolean): ClientMessage {
  return {
    id: m.id,
    sender: m.sender,
    authorName: m.authorName,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    attachments: m.attachments.map((a) => ({
      ...a,
      url: forVisitor
        ? `${API_BASE}/attachments/${a.id}?sig=${attachmentSignature(a.id)}`
        : `${API_BASE}/attachments/${a.id}`,
    })),
  }
}

export function clientConversation(c: ChatConversation): ClientConversation {
  return {
    id: c.id,
    visitorName: c.visitorName,
    visitorEmail: c.visitorEmail,
    status: c.status,
    pageUrl: c.pageUrl,
    unread: c.unreadForAgents,
    lastMessageAt: c.lastMessageAt.toISOString(),
    preview: c.lastMessagePreview,
    notifications: c.hasPush,
  }
}

import { API_BASE } from './constants'
import type { ChatConversation, ChatMessage } from './db'
import { visitorIsOnline, type ChatVisitor, type ListedVisitor } from './visitors'
import { cartTotal, type CartLine, type TrailPage } from './trail'
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
  visitorId: string | null
  startedBy: 'visitor' | 'agent'
}

/** A visitor as the admin sees them: where they are, where they have been and
 *  what is in their basket. */
export type ClientVisitor = {
  id: string
  online: boolean
  device: string | null
  referrer: string | null
  currentPath: string | null
  currentTitle: string | null
  pages: TrailPage[]
  pageViews: number
  cart: CartLine[] | null
  cartTotal: string | null
  cartUpdatedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
}

export type ClientListedVisitor = ClientVisitor & {
  conversationId: string | null
  conversationStatus: 'open' | 'closed' | null
  name: string | null
  email: string | null
  unread: number
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
    visitorId: c.visitorId,
    startedBy: c.startedBy,
  }
}

export function clientVisitor(v: ChatVisitor): ClientVisitor {
  const cart = v.cart && v.cart.length > 0 ? v.cart : null
  return {
    id: v.id,
    online: visitorIsOnline(v),
    device: v.device,
    referrer: v.referrer,
    currentPath: v.currentPath,
    currentTitle: v.currentTitle,
    pages: v.pages,
    pageViews: v.pageViews,
    cart,
    cartTotal: cart ? cartTotal(cart) : null,
    cartUpdatedAt: v.cartUpdatedAt?.toISOString() ?? null,
    firstSeenAt: v.firstSeenAt.toISOString(),
    lastSeenAt: v.lastSeenAt.toISOString(),
  }
}

export function clientListedVisitor(v: ListedVisitor): ClientListedVisitor {
  return {
    ...clientVisitor(v),
    conversationId: v.conversationId,
    conversationStatus: v.conversationStatus,
    name: v.visitorName,
    email: v.visitorEmail,
    unread: v.unread,
  }
}

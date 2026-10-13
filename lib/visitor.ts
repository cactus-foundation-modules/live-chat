import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { VISITOR_HEADER } from './constants'
import { getConversation, getTokenHash, type ChatConversation } from './db'

// A visitor proves a chat is theirs with a secret their browser was handed when
// the chat began: "<conversation id>.<secret>" in a header on every request.
// Only a hash of the secret is stored. No account, no cookie.

export function newConversationId(): string {
  return randomBytes(12).toString('hex')
}

export function newSecret(): string {
  return randomBytes(24).toString('base64url')
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** A one-way, salted hash of the visitor's address, so a burst of new chats
 *  from one place can be counted without keeping anybody's address. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${process.env.ENCRYPTION_KEY ?? ''}:chat-ip:${ip}`).digest('hex').slice(0, 32)
}

function parseClaim(value: string | null): { id: string; secret: string } | null {
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  const id = value.slice(0, dot)
  const secret = value.slice(dot + 1)
  if (!/^[a-f0-9]{24}$/.test(id) || secret.length < 16 || secret.length > 128) return null
  return { id, secret }
}

/** The chat this request has a valid claim on, or null. */
export async function visitorConversation(request: NextRequest): Promise<ChatConversation | null> {
  const claim = parseClaim(request.headers.get(VISITOR_HEADER))
  if (!claim) return null
  const stored = await getTokenHash(claim.id)
  if (!stored) return null
  const given = Buffer.from(hashSecret(claim.secret), 'hex')
  const want = Buffer.from(stored, 'hex')
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null
  return getConversation(claim.id)
}

// Attachment links a visitor can open without sending a header: a signature
// over the attachment id, so a link works for whoever was given it and nobody
// can make one up.
export function attachmentSignature(attachmentId: string): string {
  return createHmac('sha256', process.env.ENCRYPTION_KEY ?? 'chat').update(`chat-attachment:${attachmentId}`).digest('base64url').slice(0, 32)
}

export function attachmentSignatureValid(attachmentId: string, sig: string | null): boolean {
  if (!sig) return false
  const want = Buffer.from(attachmentSignature(attachmentId))
  const given = Buffer.from(sig)
  return want.length === given.length && timingSafeEqual(want, given)
}

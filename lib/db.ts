import { prisma } from '@/lib/db/prisma'
import { previewOf } from './text'

// ---------------------------------------------------------------------------
// Every read and write of the chat_ tables. Raw SQL because the tables belong
// to this module rather than core's Prisma schema.
// ---------------------------------------------------------------------------

export type ChatStatus = 'open' | 'closed'
export type ChatSender = 'visitor' | 'agent' | 'system'

export type ChatConversation = {
  id: string
  visitorName: string | null
  visitorEmail: string | null
  status: ChatStatus
  pageUrl: string | null
  /** The visitor row this chat belongs to, when they agreed to be listed. */
  visitorId: string | null
  startedBy: 'visitor' | 'agent'
  unreadForAgents: number
  unreadForVisitor: number
  lastMessageAt: Date
  lastMessagePreview: string | null
  hasPush: boolean
  transcriptSentAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type ChatAttachment = {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
}

export type ChatMessage = {
  id: number
  conversationId: string
  sender: ChatSender
  authorName: string | null
  body: string
  createdAt: Date
  attachments: ChatAttachment[]
}

export type StoredAttachment = ChatAttachment & {
  conversationId: string
  messageId: number
  provider: string
  key: string
  url: string
}

type Row = Record<string, unknown>

function toConversation(r: Row): ChatConversation {
  return {
    id: String(r.id),
    visitorName: (r.visitor_name as string | null) ?? null,
    visitorEmail: (r.visitor_email as string | null) ?? null,
    status: r.status === 'closed' ? 'closed' : 'open',
    pageUrl: (r.page_url as string | null) ?? null,
    visitorId: (r.visitor_id as string | null) ?? null,
    startedBy: r.started_by === 'agent' ? 'agent' : 'visitor',
    unreadForAgents: Number(r.unread_for_agents ?? 0),
    unreadForVisitor: Number(r.unread_for_visitor ?? 0),
    lastMessageAt: r.last_message_at as Date,
    lastMessagePreview: (r.last_message_preview as string | null) ?? null,
    hasPush: r.push_subscription != null,
    transcriptSentAt: (r.transcript_sent_at as Date | null) ?? null,
    closedAt: (r.closed_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  }
}

function toAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((a): a is Row => !!a && typeof a === 'object')
    .map((a) => ({
      id: String(a.id),
      filename: String(a.filename ?? 'attachment'),
      contentType: String(a.content_type ?? 'application/octet-stream'),
      sizeBytes: Number(a.size_bytes ?? 0),
    }))
}

function toMessage(r: Row): ChatMessage {
  const sender = r.sender === 'agent' || r.sender === 'system' ? r.sender : 'visitor'
  return {
    id: Number(r.id),
    conversationId: String(r.conversation_id),
    sender,
    authorName: (r.author_name as string | null) ?? null,
    body: (r.body as string | null) ?? '',
    createdAt: r.created_at as Date,
    attachments: toAttachments(r.attachments),
  }
}

// --- conversations ---------------------------------------------------------

export async function createConversation(data: {
  id: string
  tokenHash: string
  name: string | null
  email: string | null
  pageUrl: string | null
  ipHash: string | null
  visitorId?: string | null
  startedBy?: 'visitor' | 'agent'
  /** Begun by an automatic message rather than a person. */
  autoStarted?: boolean
}): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "chat_conversations" ("id", "visitor_token_hash", "visitor_name", "visitor_email", "page_url", "ip_hash", "visitor_id", "started_by", "auto_started")
    VALUES (${data.id}, ${data.tokenHash}, ${data.name}, ${data.email}, ${data.pageUrl}, ${data.ipHash}, ${data.visitorId ?? null}, ${data.startedBy ?? 'visitor'}, ${data.autoStarted ?? false})
  `
}

export async function getConversation(id: string): Promise<ChatConversation | null> {
  const rows = await prisma.$queryRaw<Row[]>`SELECT * FROM "chat_conversations" WHERE "id" = ${id} LIMIT 1`
  return rows[0] ? toConversation(rows[0]) : null
}

export async function getTokenHash(id: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ visitor_token_hash: string }>>`
    SELECT "visitor_token_hash" FROM "chat_conversations" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0]?.visitor_token_hash ?? null
}

export async function listConversations(status: ChatStatus, limit = 100): Promise<ChatConversation[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT * FROM "chat_conversations" WHERE "status" = ${status}
    ORDER BY "last_message_at" DESC LIMIT ${limit}
  `
  return rows.map(toConversation)
}

/** For the conversation provider: newest first, optionally only those changed
 *  since a moment, and paged by last message time. A chat opened by an automatic
 *  message stays out of this and of the by-email listing until the visitor has
 *  written back, so an unanswered hello leaves nothing in the Unified Inbox. */
export async function listConversationPage(opts: { since?: Date; before?: Date; limit: number }): Promise<ChatConversation[]> {
  const since = opts.since ?? new Date(0)
  const before = opts.before ?? new Date('9999-12-31T00:00:00Z')
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT * FROM "chat_conversations"
    WHERE "updated_at" >= ${since} AND "last_message_at" < ${before}
      AND ("auto_started" = false OR EXISTS (SELECT 1 FROM "chat_messages" m WHERE m."conversation_id" = "chat_conversations"."id" AND m."sender" = 'visitor'))
    ORDER BY "last_message_at" DESC LIMIT ${opts.limit}
  `
  return rows.map(toConversation)
}

export async function listConversationsByEmails(emails: string[]): Promise<ChatConversation[]> {
  const wanted = emails.map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (wanted.length === 0) return []
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT * FROM "chat_conversations" WHERE lower("visitor_email") = ANY(${wanted})
      AND ("auto_started" = false OR EXISTS (SELECT 1 FROM "chat_messages" m WHERE m."conversation_id" = "chat_conversations"."id" AND m."sender" = 'visitor'))
    ORDER BY "last_message_at" DESC LIMIT 50
  `
  return rows.map(toConversation)
}

export async function setVisitorDetails(id: string, data: { name?: string | null; email?: string | null }): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "chat_conversations" SET
      "visitor_name" = COALESCE(${data.name ?? null}, "visitor_name"),
      "visitor_email" = COALESCE(${data.email ?? null}, "visitor_email"),
      "updated_at" = now()
    WHERE "id" = ${id}
  `
}

export async function setStatus(id: string, status: ChatStatus): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "chat_conversations" SET
      "status" = ${status},
      "closed_at" = CASE WHEN ${status} = 'closed' THEN now() ELSE NULL END,
      "updated_at" = now()
    WHERE "id" = ${id}
  `
}

export async function markReadByAgents(id: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "chat_conversations" SET "unread_for_agents" = 0
    WHERE "id" = ${id} AND "unread_for_agents" <> 0
  `
}

export async function markReadByVisitor(id: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "chat_conversations" SET "unread_for_visitor" = 0
    WHERE "id" = ${id} AND "unread_for_visitor" <> 0
  `
}

export async function totalUnread(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT COUNT(*) AS n FROM "chat_conversations" WHERE "status" = 'open' AND "unread_for_agents" > 0
  `
  return Number(rows[0]?.n ?? 0)
}

export async function setPushSubscription(id: string, subscription: unknown | null): Promise<void> {
  const json = subscription == null ? null : JSON.stringify(subscription)
  await prisma.$executeRaw`
    UPDATE "chat_conversations" SET "push_subscription" = ${json}::jsonb WHERE "id" = ${id}
  `
}

export async function getPushSubscription(id: string): Promise<unknown | null> {
  const rows = await prisma.$queryRaw<Array<{ push_subscription: unknown }>>`
    SELECT "push_subscription" FROM "chat_conversations" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0]?.push_subscription ?? null
}

/** True only for the caller that claimed it, so a double press sends one email. */
export async function claimTranscript(id: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "chat_conversations" SET "transcript_sent_at" = now()
    WHERE "id" = ${id} AND "transcript_sent_at" IS NULL
    RETURNING "id"
  `
  return rows.length > 0
}

export async function releaseTranscript(id: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "chat_conversations" SET "transcript_sent_at" = NULL WHERE "id" = ${id}`
}

export async function countConversationsFromIp(ipHash: string, since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT COUNT(*) AS n FROM "chat_conversations" WHERE "ip_hash" = ${ipHash} AND "created_at" > ${since}
  `
  return Number(rows[0]?.n ?? 0)
}

export async function countVisitorMessages(conversationId: string, since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT COUNT(*) AS n FROM "chat_messages"
    WHERE "conversation_id" = ${conversationId} AND "sender" = 'visitor' AND "created_at" > ${since}
  `
  return Number(rows[0]?.n ?? 0)
}

// --- messages --------------------------------------------------------------

export type NewAttachment = {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  provider: string
  key: string
  url: string
}

/**
 * Saves one message and its files, and moves the conversation along with it:
 * newest-message time, preview, and the unread count of whichever side did not
 * write it. A message on a closed chat opens it again.
 */
export async function insertMessage(data: {
  conversationId: string
  sender: ChatSender
  authorUserId?: string | null
  authorName?: string | null
  body: string
  attachments?: NewAttachment[]
}): Promise<ChatMessage> {
  const attachments = data.attachments ?? []
  const preview = previewOf(data.body) ?? (attachments[0] ? `📎 ${attachments[0].filename}` : null)
  const toAgents = data.sender === 'visitor' ? 1 : 0
  const toVisitor = data.sender === 'agent' ? 1 : 0

  return prisma.$transaction(async (tx) => {
    const inserted = await tx.$queryRaw<Row[]>`
      INSERT INTO "chat_messages" ("conversation_id", "sender", "author_user_id", "author_name", "body")
      VALUES (${data.conversationId}, ${data.sender}, ${data.authorUserId ?? null}, ${data.authorName ?? null}, ${data.body})
      RETURNING *
    `
    const row = inserted[0]
    if (!row) throw new Error('The message was not saved.')
    const messageId = Number(row.id)
    for (const a of attachments) {
      await tx.$executeRaw`
        INSERT INTO "chat_attachments" ("id", "message_id", "conversation_id", "filename", "content_type", "size_bytes", "media_provider", "media_key", "media_url")
        VALUES (${a.id}, ${messageId}, ${data.conversationId}, ${a.filename}, ${a.contentType}, ${a.sizeBytes}, ${a.provider}, ${a.key}, ${a.url})
      `
    }
    // A system line ("chat ended") is not news to anybody, so it moves nothing.
    if (data.sender !== 'system') {
      await tx.$executeRaw`
        UPDATE "chat_conversations" SET
          "last_message_at" = now(),
          "last_message_preview" = ${preview},
          "unread_for_agents" = "unread_for_agents" + ${toAgents}::int4,
          "unread_for_visitor" = "unread_for_visitor" + ${toVisitor}::int4,
          "status" = 'open',
          "closed_at" = NULL,
          "updated_at" = now()
        WHERE "id" = ${data.conversationId}
      `
    } else {
      await tx.$executeRaw`UPDATE "chat_conversations" SET "updated_at" = now() WHERE "id" = ${data.conversationId}`
    }
    return toMessage({
      ...row,
      attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, content_type: a.contentType, size_bytes: a.sizeBytes })),
    })
  })
}

/** Messages after a given id (0 for all), oldest first, with their files. */
export async function listMessages(conversationId: string, afterId = 0, limit = 500): Promise<ChatMessage[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT m.*, COALESCE(
      (SELECT json_agg(json_build_object('id', a."id", 'filename', a."filename", 'content_type', a."content_type", 'size_bytes', a."size_bytes") ORDER BY a."created_at")
       FROM "chat_attachments" a WHERE a."message_id" = m."id"),
      '[]'::json) AS attachments
    FROM "chat_messages" m
    WHERE m."conversation_id" = ${conversationId} AND m."id" > ${afterId}
    ORDER BY m."id" ASC
    LIMIT ${limit}
  `
  return rows.map(toMessage)
}

// --- attachments -----------------------------------------------------------

export async function getAttachment(id: string): Promise<StoredAttachment | null> {
  const rows = await prisma.$queryRaw<Row[]>`SELECT * FROM "chat_attachments" WHERE "id" = ${id} LIMIT 1`
  const r = rows[0]
  if (!r) return null
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    messageId: Number(r.message_id),
    filename: String(r.filename),
    contentType: String(r.content_type),
    sizeBytes: Number(r.size_bytes),
    provider: String(r.media_provider),
    key: String(r.media_key),
    url: String(r.media_url),
  }
}

export async function storedFilesFor(conversationIds: string[]): Promise<Array<{ provider: string; key: string }>> {
  if (conversationIds.length === 0) return []
  return prisma.$queryRaw<Array<{ provider: string; key: string }>>`
    SELECT "media_provider" AS provider, "media_key" AS key FROM "chat_attachments"
    WHERE "conversation_id" = ANY(${conversationIds})
  `
}

// --- deletion --------------------------------------------------------------

export async function deleteConversations(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  return prisma.$executeRaw`DELETE FROM "chat_conversations" WHERE "id" = ANY(${ids})`
}

// ::int4 because Prisma sends a JS number as bigint, and make_interval's
// months argument takes no bigint.
export async function conversationsOlderThan(months: number, limit = 200): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "chat_conversations"
    WHERE "last_message_at" < now() - make_interval(months => ${months}::int4)
    ORDER BY "last_message_at" ASC LIMIT ${limit}
  `
  return rows.map((r) => r.id)
}

import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { ONLINE_WINDOW_SECONDS, PRESENCE_HEADER, VISITOR_RETENTION_DAYS } from './constants'
import { hashSecret } from './visitor'
import { readCart, readTrail, type CartLine, type CartLineIn, type TrailPage } from './trail'

// Every read and write of chat_visitors: the visitors who said yes to the Live
// chat cookie category, where they have been and what is in their basket.

export type ChatVisitor = {
  id: string
  device: string | null
  referrer: string | null
  currentPath: string | null
  currentTitle: string | null
  pages: TrailPage[]
  pageViews: number
  cart: CartLine[] | null
  cartUpdatedAt: Date | null
  firstSeenAt: Date
  lastSeenAt: Date
  /** When their last tab on the site closed; null while they are about. */
  leftAt: Date | null
}

/** A visitor as the admin's list shows them, with the chat they are in if any. */
export type ListedVisitor = ChatVisitor & {
  conversationId: string | null
  conversationStatus: 'open' | 'closed' | null
  visitorName: string | null
  visitorEmail: string | null
  unread: number
}

type Row = Record<string, unknown>

function toVisitor(r: Row): ChatVisitor {
  return {
    id: String(r.id),
    device: (r.device as string | null) ?? null,
    referrer: (r.referrer as string | null) ?? null,
    currentPath: (r.current_path as string | null) ?? null,
    currentTitle: (r.current_title as string | null) ?? null,
    pages: readTrail(r.pages),
    pageViews: Number(r.page_views ?? 0),
    cart: readCart(r.cart),
    cartUpdatedAt: (r.cart_updated_at as Date | null) ?? null,
    firstSeenAt: r.first_seen_at as Date,
    lastSeenAt: r.last_seen_at as Date,
    leftAt: (r.left_at as Date | null) ?? null,
  }
}

function toListed(r: Row): ListedVisitor {
  return {
    ...toVisitor(r),
    conversationId: (r.conversation_id as string | null) ?? null,
    conversationStatus: r.conversation_status === 'open' || r.conversation_status === 'closed' ? r.conversation_status : null,
    visitorName: (r.visitor_name as string | null) ?? null,
    visitorEmail: (r.visitor_email as string | null) ?? null,
    unread: Number(r.unread_for_agents ?? 0),
  }
}

/** On the site now: checked in lately, and has not closed the site since. */
export function visitorIsOnline(v: Pick<ChatVisitor, 'lastSeenAt' | 'leftAt'>): boolean {
  return v.leftAt === null && Date.now() - v.lastSeenAt.getTime() < ONLINE_WINDOW_SECONDS * 1000
}

// --- the visitor's claim -----------------------------------------------------

function parseClaim(value: string | null): { id: string; secret: string } | null {
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  const id = value.slice(0, dot)
  const secret = value.slice(dot + 1)
  if (!/^[a-f0-9]{24}$/.test(id) || secret.length < 16 || secret.length > 128) return null
  return { id, secret }
}

/** The visitor row this request has a valid claim on, with the secret it was
 *  proved with (a chat we start for them is claimed with the same secret). */
export async function visitorFromRequest(request: NextRequest): Promise<{ id: string; secret: string } | null> {
  const claim = parseClaim(request.headers.get(PRESENCE_HEADER))
  if (!claim) return null
  const rows = await prisma.$queryRaw<Array<{ token_hash: string }>>`
    SELECT "token_hash" FROM "chat_visitors" WHERE "id" = ${claim.id} LIMIT 1
  `
  const stored = rows[0]?.token_hash
  if (!stored) return null
  const given = Buffer.from(hashSecret(claim.secret), 'hex')
  const want = Buffer.from(stored, 'hex')
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null
  return claim
}

// --- writes ------------------------------------------------------------------

export async function createVisitor(data: {
  id: string
  tokenHash: string
  ipHash: string | null
  device: string | null
  referrer: string | null
}): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "chat_visitors" ("id", "token_hash", "ip_hash", "device", "referrer")
    VALUES (${data.id}, ${data.tokenHash}, ${data.ipHash}, ${data.device}, ${data.referrer})
  `
}

export async function getVisitorTrail(id: string): Promise<unknown> {
  const rows = await prisma.$queryRaw<Array<{ pages: unknown }>>`SELECT "pages" FROM "chat_visitors" WHERE "id" = ${id} LIMIT 1`
  return rows[0]?.pages ?? []
}

/** One check-in: where they are now, the trail so far, and the basket when the
 *  browser reported one (undefined leaves the stored basket as it was). */
export async function recordCheckIn(id: string, data: {
  path: string
  title: string | null
  trail: TrailPage[]
  moved: boolean
  cart: CartLine[] | undefined
}): Promise<void> {
  const pages = JSON.stringify(data.trail)
  const views = data.moved ? 1 : 0
  if (data.cart === undefined) {
    await prisma.$executeRaw`
      UPDATE "chat_visitors" SET
        "current_path" = ${data.path},
        "current_title" = ${data.title},
        "pages" = ${pages}::jsonb,
        "page_views" = "page_views" + ${views}::int4,
        "last_seen_at" = now(),
        "left_at" = NULL
      WHERE "id" = ${id}
    `
    return
  }
  const cart = data.cart.length > 0 ? JSON.stringify(data.cart) : null
  await prisma.$executeRaw`
    UPDATE "chat_visitors" SET
      "current_path" = ${data.path},
      "current_title" = ${data.title},
      "pages" = ${pages}::jsonb,
      "page_views" = "page_views" + ${views}::int4,
      "cart" = ${cart}::jsonb,
      "cart_updated_at" = CASE WHEN "cart" IS DISTINCT FROM ${cart}::jsonb THEN now() ELSE "cart_updated_at" END,
      "last_seen_at" = now(),
      "left_at" = NULL
    WHERE "id" = ${id}
  `
}

/** Their browser closed its last tab on the site (or went somewhere else). The
 *  row stays, trail and basket included; they are just no longer here. */
export async function markVisitorLeft(id: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "chat_visitors" SET "left_at" = now() WHERE "id" = ${id} AND "left_at" IS NULL`
}

/** A visitor who withdrew consent, or asked to be forgotten. Their chats stay
 *  (they are a conversation with us, not a trail) but lose the link to the row. */
export async function deleteVisitor(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "chat_visitors" WHERE "id" = ${id}`
}

export async function pruneVisitors(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "chat_visitors"
    WHERE "last_seen_at" < now() - make_interval(days => ${VISITOR_RETENTION_DAYS}::int4)
  `
}

export async function countVisitorsFromIp(ipHash: string, since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT COUNT(*) AS n FROM "chat_visitors" WHERE "ip_hash" = ${ipHash} AND "first_seen_at" > ${since}
  `
  return Number(rows[0]?.n ?? 0)
}

export async function linkConversationToVisitor(conversationId: string, visitorId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "chat_conversations" SET "visitor_id" = ${visitorId} WHERE "id" = ${conversationId} AND "visitor_id" IS NULL
  `
}

// --- reads -------------------------------------------------------------------

export async function getVisitor(id: string): Promise<ChatVisitor | null> {
  const rows = await prisma.$queryRaw<Row[]>`SELECT * FROM "chat_visitors" WHERE "id" = ${id} LIMIT 1`
  return rows[0] ? toVisitor(rows[0]) : null
}

/** Everybody who checked in within the last minute or so and has not since
 *  closed the site, newest first, each
 *  with the newest chat they are in (open ones before ended ones). */
export async function listOnlineVisitors(limit = 200): Promise<ListedVisitor[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT v.*, c."id" AS conversation_id, c."status" AS conversation_status,
           c."visitor_name", c."visitor_email", c."unread_for_agents"
    FROM "chat_visitors" v
    LEFT JOIN LATERAL (
      SELECT "id", "status", "visitor_name", "visitor_email", "unread_for_agents"
      FROM "chat_conversations"
      WHERE "visitor_id" = v."id"
      ORDER BY ("status" = 'open') DESC, "last_message_at" DESC
      LIMIT 1
    ) c ON true
    WHERE v."last_seen_at" > now() - make_interval(secs => ${ONLINE_WINDOW_SECONDS}::int4)
      AND v."left_at" IS NULL
    ORDER BY v."last_seen_at" DESC
    LIMIT ${limit}
  `
  return rows.map(toListed)
}

/** The open chat we started with this visitor that their browser should pick
 *  up, if there is one. Only ours: a chat the visitor started was handed its
 *  own secret, so their browser already holds it. */
export async function openChatWeStarted(visitorId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "chat_conversations"
    WHERE "visitor_id" = ${visitorId} AND "started_by" = 'agent' AND "status" = 'open'
    ORDER BY "created_at" DESC LIMIT 1
  `
  return rows[0]?.id ?? null
}

/** Any open chat with this visitor, so "message them" carries on the chat that
 *  is already going rather than starting a second one beside it. */
export async function openChatWithVisitor(visitorId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "chat_conversations"
    WHERE "visitor_id" = ${visitorId} AND "status" = 'open'
    ORDER BY "last_message_at" DESC LIMIT 1
  `
  return rows[0]?.id ?? null
}

/** Marks this visitor as having had the basket message and says whether this
 *  call was the one to do it, so the message goes out once however many tabs
 *  add something at the same moment. */
export async function claimCartMessage(visitorId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "chat_visitors" SET "cart_message_at" = now()
    WHERE "id" = ${visitorId} AND "cart_message_at" IS NULL
    RETURNING "id"
  `
  return rows.length > 0
}

/** Puts the claim back when the message could not be sent after all. */
export async function releaseCartMessage(visitorId: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "chat_visitors" SET "cart_message_at" = NULL WHERE "id" = ${visitorId}`
}

export async function getVisitorTokenHash(id: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ token_hash: string }>>`SELECT "token_hash" FROM "chat_visitors" WHERE "id" = ${id} LIMIT 1`
  return rows[0]?.token_hash ?? null
}

// --- the basket ----------------------------------------------------------------

/**
 * Names and prices for a reported basket, looked up in the shop's own products
 * table when the site has one. Read only, and only by id: the browser says what
 * is in the basket, never what it is called or what it costs. Without a shop the
 * lines come back unnamed, which the admin sees as "an item".
 */
export async function resolveCart(lines: CartLineIn[]): Promise<CartLine[]> {
  if (lines.length === 0) return []
  const ids = lines.map((l) => l.productId)
  let found = new Map<string, { name: string; price: string | null }>()
  try {
    const exists = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('public.shp_products')::text AS t`
    if (exists[0]?.t) {
      const rows = await prisma.$queryRaw<Array<{ id: string; name: string; price: unknown }>>`
        SELECT "id", "name", COALESCE("sale_price", "price")::text AS price
        FROM "shp_products" WHERE "id" = ANY(${ids})
      `
      found = new Map(rows.map((r) => [r.id, { name: r.name, price: r.price == null ? null : String(r.price) }]))
    }
  } catch {
    // A shop table shaped differently from the one we know: unnamed lines are
    // still worth showing, and a check-in must never fail over a basket.
  }
  return lines.map((l) => ({
    productId: l.productId,
    name: found.get(l.productId)?.name ?? null,
    quantity: l.quantity,
    unitPrice: found.get(l.productId)?.price ?? null,
  }))
}

import { prisma } from '@/lib/db/prisma'

export type ChatSettings = {
  enabled: boolean
  position: 'left' | 'right'
  bubbleLabel: string
  greeting: string
  transcripts: boolean
  retentionMonths: number
  hideBubbleOnMobile: boolean
  awayLabel: string
  awayMessage: string
  /** List visitors who agreed to the Live chat cookie category, with where they
   *  have been and what is in their basket, so we can say hello first. */
  trackVisitors: boolean
  /** Post `cartMessage` into a visitor's chat the first time they add to their basket. */
  cartMessageEnabled: boolean
  cartMessage: string
  /** Seconds to wait after the add before the basket message goes. 0 is straight away. */
  cartMessageDelaySeconds: number
  /** Post `welcomeMessage` into the chat of a visitor who has been here
   *  `welcomeDelaySeconds` without writing to us. Once per visitor. */
  welcomeEnabled: boolean
  welcomeMessage: string
  welcomeDelaySeconds: number
  /** The name shown on the welcome and basket messages. */
  autoMessageAuthor: string
  /** Reply automatically when a visitor writes while we are offline: with
   *  `awayReplyMessage` in a chat nobody has answered yet, with
   *  `offlineNoticeMessage` in one a colleague was answering. Once per offline spell. */
  offlineNoticeEnabled: boolean
  offlineNoticeMessage: string
  awayReplyMessage: string
  /** Whether somebody is answering. Flipped by the switch, not by the settings form. */
  online: boolean
  /** When the switch last went off; null while online, or when it went off
   *  before this was recorded. */
  offlineSince: Date | null
}

/** What the settings form saves: everything but the Online switch. */
export type SavedChatSettings = Omit<ChatSettings, 'online' | 'offlineSince'>

export const DEFAULT_SETTINGS: ChatSettings = {
  enabled: true,
  position: 'right',
  bubbleLabel: 'Chat with us',
  greeting: 'Hello! Ask us anything and we will get back to you as soon as we can.',
  transcripts: true,
  retentionMonths: 12,
  hideBubbleOnMobile: false,
  awayLabel: 'Leave a message',
  awayMessage: 'We are away at the moment. Leave a message, and your email if you would like a reply, and we will get back to you when we are next in.',
  trackVisitors: true,
  cartMessageEnabled: false,
  cartMessage: 'Good choice! If you have any questions about that, or want a hand with sizes, finishes or delivery, just ask here.',
  cartMessageDelaySeconds: 0,
  welcomeEnabled: false,
  welcomeMessage: 'Hello! Have a look around, and if there is anything we can help with, just ask here.',
  welcomeDelaySeconds: 20,
  autoMessageAuthor: 'Our team',
  offlineNoticeEnabled: true,
  offlineNoticeMessage: 'Sorry - we have had to step away since we last spoke, so we cannot reply straight away.',
  awayReplyMessage: 'Thanks for your message. We are away at the moment, so we cannot reply straight away.',
  online: true,
  offlineSince: null,
}

export async function getChatSettings(): Promise<ChatSettings> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "chat_settings" WHERE "id" = 'singleton' LIMIT 1
  `.catch(() => [])
  const r = rows[0]
  if (!r) return DEFAULT_SETTINGS
  return {
    enabled: r.enabled !== false,
    position: r.position === 'left' ? 'left' : 'right',
    bubbleLabel: typeof r.bubble_label === 'string' ? r.bubble_label : DEFAULT_SETTINGS.bubbleLabel,
    greeting: typeof r.greeting === 'string' ? r.greeting : DEFAULT_SETTINGS.greeting,
    transcripts: r.transcripts !== false,
    retentionMonths: Number(r.retention_months ?? DEFAULT_SETTINGS.retentionMonths) || DEFAULT_SETTINGS.retentionMonths,
    hideBubbleOnMobile: r.hide_bubble_on_mobile === true,
    awayLabel: typeof r.away_label === 'string' ? r.away_label : DEFAULT_SETTINGS.awayLabel,
    awayMessage: typeof r.away_message === 'string' ? r.away_message : DEFAULT_SETTINGS.awayMessage,
    trackVisitors: r.track_visitors !== false,
    cartMessageEnabled: r.cart_message_enabled === true,
    cartMessage: typeof r.cart_message === 'string' && r.cart_message ? r.cart_message : DEFAULT_SETTINGS.cartMessage,
    cartMessageDelaySeconds: Math.max(0, Number(r.cart_message_delay_seconds ?? 0) || 0),
    welcomeEnabled: r.welcome_enabled === true,
    welcomeMessage: typeof r.welcome_message === 'string' && r.welcome_message ? r.welcome_message : DEFAULT_SETTINGS.welcomeMessage,
    welcomeDelaySeconds: Math.max(0, Number(r.welcome_delay_seconds ?? DEFAULT_SETTINGS.welcomeDelaySeconds) || 0),
    autoMessageAuthor: typeof r.auto_message_author === 'string' && r.auto_message_author.trim() ? r.auto_message_author : DEFAULT_SETTINGS.autoMessageAuthor,
    offlineNoticeEnabled: r.offline_notice_enabled !== false,
    offlineNoticeMessage: typeof r.offline_notice_message === 'string' && r.offline_notice_message.trim() ? r.offline_notice_message : DEFAULT_SETTINGS.offlineNoticeMessage,
    awayReplyMessage: typeof r.away_reply_message === 'string' && r.away_reply_message.trim() ? r.away_reply_message : DEFAULT_SETTINGS.awayReplyMessage,
    online: r.agent_online !== false,
    offlineSince: r.agent_online === false && r.agent_offline_at instanceof Date ? r.agent_offline_at : null,
  }
}

export async function saveChatSettings(next: SavedChatSettings): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "chat_settings" ("id", "enabled", "position", "bubble_label", "greeting", "transcripts", "retention_months", "hide_bubble_on_mobile", "away_label", "away_message", "track_visitors", "cart_message_enabled", "cart_message", "cart_message_delay_seconds", "welcome_enabled", "welcome_message", "welcome_delay_seconds", "auto_message_author", "offline_notice_enabled", "offline_notice_message", "away_reply_message", "updated_at")
    VALUES ('singleton', ${next.enabled}, ${next.position}, ${next.bubbleLabel}, ${next.greeting}, ${next.transcripts}, ${next.retentionMonths}::int4, ${next.hideBubbleOnMobile}, ${next.awayLabel}, ${next.awayMessage}, ${next.trackVisitors}, ${next.cartMessageEnabled}, ${next.cartMessage}, ${next.cartMessageDelaySeconds}::int4, ${next.welcomeEnabled}, ${next.welcomeMessage}, ${next.welcomeDelaySeconds}::int4, ${next.autoMessageAuthor}, ${next.offlineNoticeEnabled}, ${next.offlineNoticeMessage}, ${next.awayReplyMessage}, now())
    ON CONFLICT ("id") DO UPDATE SET
      "enabled" = EXCLUDED."enabled",
      "position" = EXCLUDED."position",
      "bubble_label" = EXCLUDED."bubble_label",
      "greeting" = EXCLUDED."greeting",
      "transcripts" = EXCLUDED."transcripts",
      "retention_months" = EXCLUDED."retention_months",
      "hide_bubble_on_mobile" = EXCLUDED."hide_bubble_on_mobile",
      "away_label" = EXCLUDED."away_label",
      "away_message" = EXCLUDED."away_message",
      "track_visitors" = EXCLUDED."track_visitors",
      "cart_message_enabled" = EXCLUDED."cart_message_enabled",
      "cart_message" = EXCLUDED."cart_message",
      "cart_message_delay_seconds" = EXCLUDED."cart_message_delay_seconds",
      "welcome_enabled" = EXCLUDED."welcome_enabled",
      "welcome_message" = EXCLUDED."welcome_message",
      "welcome_delay_seconds" = EXCLUDED."welcome_delay_seconds",
      "auto_message_author" = EXCLUDED."auto_message_author",
      "offline_notice_enabled" = EXCLUDED."offline_notice_enabled",
      "offline_notice_message" = EXCLUDED."offline_notice_message",
      "away_reply_message" = EXCLUDED."away_reply_message",
      "updated_at" = now()
  `
}

/** The online/offline switch. Its own write, so saving the settings form can
 *  never put somebody back online by accident. Returns when the offline spell
 *  began if this press is the one that went offline, so the caller can tell
 *  the visitors left waiting; null otherwise (going online, or pressing
 *  Offline when already offline - that spell carries on). */
export async function setChatOnline(online: boolean): Promise<Date | null> {
  // The CTE reads the row as it was before this statement, so "was online"
  // is the old value, not the one being written.
  const rows = await prisma.$queryRaw<{ went_offline: boolean; offline_at: Date | null }[]>`
    WITH before AS (SELECT "agent_online" FROM "chat_settings" WHERE "id" = 'singleton')
    INSERT INTO "chat_settings" ("id", "agent_online", "agent_offline_at", "updated_at")
    VALUES ('singleton', ${online}::boolean, CASE WHEN ${online}::boolean THEN NULL ELSE now() END, now())
    ON CONFLICT ("id") DO UPDATE SET
      "agent_online" = EXCLUDED."agent_online",
      "agent_offline_at" = CASE
        WHEN EXCLUDED."agent_online" THEN NULL
        WHEN "chat_settings"."agent_online" THEN now()
        ELSE COALESCE("chat_settings"."agent_offline_at", now())
      END,
      "updated_at" = now()
    RETURNING
      (NOT ${online}::boolean AND COALESCE((SELECT "agent_online" FROM before), true)) AS went_offline,
      "agent_offline_at" AS offline_at
  `
  const row = rows[0]
  return row?.went_offline && row.offline_at ? row.offline_at : null
}

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
  /** Whether somebody is answering. Flipped by the switch, not by the settings form. */
  online: boolean
}

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
  online: true,
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
    online: r.agent_online !== false,
  }
}

export async function saveChatSettings(next: Omit<ChatSettings, 'online'>): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "chat_settings" ("id", "enabled", "position", "bubble_label", "greeting", "transcripts", "retention_months", "hide_bubble_on_mobile", "away_label", "away_message", "track_visitors", "cart_message_enabled", "cart_message", "cart_message_delay_seconds", "welcome_enabled", "welcome_message", "welcome_delay_seconds", "auto_message_author", "updated_at")
    VALUES ('singleton', ${next.enabled}, ${next.position}, ${next.bubbleLabel}, ${next.greeting}, ${next.transcripts}, ${next.retentionMonths}::int4, ${next.hideBubbleOnMobile}, ${next.awayLabel}, ${next.awayMessage}, ${next.trackVisitors}, ${next.cartMessageEnabled}, ${next.cartMessage}, ${next.cartMessageDelaySeconds}::int4, ${next.welcomeEnabled}, ${next.welcomeMessage}, ${next.welcomeDelaySeconds}::int4, ${next.autoMessageAuthor}, now())
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
      "updated_at" = now()
  `
}

/** The online/offline switch. Its own write, so saving the settings form can
 *  never put somebody back online by accident. */
export async function setChatOnline(online: boolean): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "chat_settings" ("id", "agent_online", "updated_at") VALUES ('singleton', ${online}, now())
    ON CONFLICT ("id") DO UPDATE SET "agent_online" = EXCLUDED."agent_online", "updated_at" = now()
  `
}

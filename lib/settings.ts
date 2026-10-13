import { prisma } from '@/lib/db/prisma'

export type ChatSettings = {
  enabled: boolean
  position: 'left' | 'right'
  bubbleLabel: string
  greeting: string
  transcripts: boolean
  retentionMonths: number
}

export const DEFAULT_SETTINGS: ChatSettings = {
  enabled: true,
  position: 'right',
  bubbleLabel: 'Chat with us',
  greeting: 'Hello! Ask us anything and we will get back to you as soon as we can.',
  transcripts: true,
  retentionMonths: 12,
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
  }
}

export async function saveChatSettings(next: ChatSettings): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "chat_settings" ("id", "enabled", "position", "bubble_label", "greeting", "transcripts", "retention_months", "updated_at")
    VALUES ('singleton', ${next.enabled}, ${next.position}, ${next.bubbleLabel}, ${next.greeting}, ${next.transcripts}, ${next.retentionMonths}::int4, now())
    ON CONFLICT ("id") DO UPDATE SET
      "enabled" = EXCLUDED."enabled",
      "position" = EXCLUDED."position",
      "bubble_label" = EXCLUDED."bubble_label",
      "greeting" = EXCLUDED."greeting",
      "transcripts" = EXCLUDED."transcripts",
      "retention_months" = EXCLUDED."retention_months",
      "updated_at" = now()
  `
}

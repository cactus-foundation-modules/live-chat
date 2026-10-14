import { prisma } from '@/lib/db/prisma'

export const MAX_AGENT_NAME_CHARS = 40

/** The name this colleague chose to show visitors, if they chose one. */
export async function getAgentNameOverride(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT "name" FROM "chat_agent_names" WHERE "user_id" = ${userId} LIMIT 1
  `.catch(() => [])
  return rows[0]?.name?.trim() || null
}

/** Sets the colleague's own name for visitors; an empty name goes back to the account's. */
export async function setAgentNameOverride(userId: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, MAX_AGENT_NAME_CHARS)
  if (!clean) {
    await prisma.$executeRaw`DELETE FROM "chat_agent_names" WHERE "user_id" = ${userId}`
    return
  }
  await prisma.$executeRaw`
    INSERT INTO "chat_agent_names" ("user_id", "name", "updated_at") VALUES (${userId}, ${clean}, now())
    ON CONFLICT ("user_id") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = now()
  `
}

/** The name from the colleague's account: their display name, or their username
 *  when they have not set one. Their first name only, because "Chris" reads like
 *  a person and "Chris Taylor-Guest" reads like a ticket system. */
export async function accountAgentName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } })
  const full = user?.displayName?.trim() || user?.username?.trim() || ''
  return full.split(/\s+/)[0] || null
}

/** The name a visitor sees on a reply: the colleague's own override if they set
 *  one (used exactly as typed), otherwise the first name from their account. */
export async function agentName(userId: string): Promise<string | null> {
  return (await getAgentNameOverride(userId)) ?? accountAgentName(userId)
}

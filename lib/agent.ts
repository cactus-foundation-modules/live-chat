import { prisma } from '@/lib/db/prisma'

/** The name a visitor sees on a reply: the colleague's display name, or their
 *  username when they have not set one. Their first name only, because "Chris"
 *  reads like a person and "Chris Taylor-Guest" reads like a ticket system. */
export async function agentName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } })
  const full = user?.displayName?.trim() || user?.username?.trim() || ''
  return full.split(/\s+/)[0] || null
}

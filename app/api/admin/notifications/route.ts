import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { errorResponse } from '@/lib/utils'
import { getNotificationKinds } from '@/lib/notifications/kinds'
import { resolvePrefs, type CategoryPref } from '@/lib/notifications/preferences'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { MODULE_NAME, PERM_VIEW } from '@/modules/chat/lib/constants'

// The signed-in colleague's own live chat notifications, from the cog in the
// chat header: whether each kind shows on the site (the bell and the
// Notifications page) and whether it also pops up as a browser alert.
//
// The very same choices as Settings > Notifications, read and written in the
// same place on the user's own row, so the two can never disagree. Its own door
// because that page needs config.manage and somebody who answers chats may not
// hold it; this one only ever touches this module's kinds, and only the
// caller's own row.

async function chatKinds() {
  return (await getNotificationKinds()).filter((k) => k.group === MODULE_NAME)
}

async function storedPrefs(userId: string): Promise<Record<string, unknown>> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } })
  const raw = row?.notificationPrefs
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
}

export async function GET() {
  const auth = await requirePermission(PERM_VIEW)
  if ('response' in auth) return auth.response
  const [kinds, stored] = await Promise.all([chatKinds(), storedPrefs(auth.user.id)])
  const prefs = resolvePrefs(stored, kinds)
  return NextResponse.json(
    { kinds: kinds.map((k) => ({ id: k.id, label: k.label, description: k.description, pref: prefs[k.id] })) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

const Body = z.record(z.string(), z.object({ show: z.boolean(), browser: z.boolean() }))

export async function PUT(request: NextRequest) {
  const auth = await requirePermission(PERM_VIEW)
  if ('response' in auth) return auth.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Those notification choices could not be read.')

  const [kinds, stored] = await Promise.all([chatKinds(), storedPrefs(auth.user.id)])
  // Only this module's kinds are taken from the request; every other choice on
  // the row is left exactly where it was.
  const merged: Record<string, CategoryPref> = {}
  for (const k of kinds) {
    const choice = parsed.data[k.id]
    if (choice) merged[k.id] = choice
  }
  await prisma.user.update({ where: { id: auth.user.id }, data: { notificationPrefs: { ...stored, ...merged } } })
  return NextResponse.json({ ok: true })
}

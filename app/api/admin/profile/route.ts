import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { PERM_REPLY } from '@/modules/chat/lib/constants'
import { accountAgentName, getAgentNameOverride, MAX_AGENT_NAME_CHARS, setAgentNameOverride } from '@/modules/chat/lib/agent'

// The signed-in colleague's own name for visitors. Theirs alone: it only ever
// reads and writes the row for the user in the session.

export async function GET() {
  const auth = await requirePermission(PERM_REPLY)
  if ('response' in auth) return auth.response
  const [override, fallback] = await Promise.all([getAgentNameOverride(auth.user.id), accountAgentName(auth.user.id)])
  return NextResponse.json({ name: override ?? '', accountName: fallback }, { headers: { 'Cache-Control': 'no-store' } })
}

const Body = z.object({ name: z.string().trim().max(MAX_AGENT_NAME_CHARS, 'That name is a bit long.') })

export async function PUT(request: NextRequest) {
  const auth = await requirePermission(PERM_REPLY)
  if ('response' in auth) return auth.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'That name could not be saved.')
  await setAgentNameOverride(auth.user.id, parsed.data.name)
  return NextResponse.json({ ok: true })
}

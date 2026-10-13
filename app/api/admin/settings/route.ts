import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { getChatSettings, saveChatSettings } from '@/modules/chat/lib/settings'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { PERM_MANAGE } from '@/modules/chat/lib/constants'

export async function GET() {
  const auth = await requirePermission(PERM_MANAGE)
  if ('response' in auth) return auth.response
  return NextResponse.json(await getChatSettings(), { headers: { 'Cache-Control': 'no-store' } })
}

const Body = z.object({
  enabled: z.boolean(),
  position: z.enum(['left', 'right']),
  bubbleLabel: z.string().trim().max(40),
  greeting: z.string().trim().max(300),
  transcripts: z.boolean(),
  retentionMonths: z.number().int().min(1).max(120),
})

export async function PUT(request: NextRequest) {
  const auth = await requirePermission(PERM_MANAGE)
  if ('response' in auth) return auth.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Those settings could not be saved.')
  await saveChatSettings(parsed.data)
  return NextResponse.json({ ok: true })
}

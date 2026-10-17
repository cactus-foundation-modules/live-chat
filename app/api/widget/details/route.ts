import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { setVisitorDetails } from '@/modules/chat/lib/db'
import { visitorConversation } from '@/modules/chat/lib/visitor'
import { cleanEmail, cleanName } from '@/modules/chat/lib/text'
import { announce } from '@/modules/chat/lib/notify'

// The visitor saves their name and/or email without sending a message. Before
// the first message there is no chat to attach them to, so the browser keeps
// them and they go with that message instead; this is for a chat under way.

const Body = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(254).optional(),
})

export async function POST(request: NextRequest) {
  const conversation = await visitorConversation(request)
  if (!conversation) return errorResponse('Chat not found', 404)
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Those details could not be read.')
  const name = cleanName(parsed.data.name)
  const email = parsed.data.email?.trim() ? cleanEmail(parsed.data.email) : null
  if (parsed.data.email?.trim() && !email) return errorResponse('That email address does not look quite right.')
  if (!name && !email) return errorResponse('There is nothing to save.')
  await setVisitorDetails(conversation.id, { name, email })
  // The Unified Inbox keeps its own copy of the chat, and would otherwise only
  // learn the name on the visitor's next message or its next timed collection.
  after(() => announce(conversation.id))
  return NextResponse.json({ ok: true, name, email }, { headers: { 'Cache-Control': 'no-store' } })
}

import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { replaceVisitorDetails } from '@/modules/chat/lib/db'
import { visitorConversation } from '@/modules/chat/lib/visitor'
import { cleanEmail, cleanName, cleanPhone } from '@/modules/chat/lib/text'
import { announce } from '@/modules/chat/lib/notify'

// The visitor saves or edits their name, phone and/or email without sending a
// message. Before the first message there is no chat to attach them to, so the
// browser keeps them and they go with that message instead; this is for a chat
// under way. A field that is left out stays as it was; one sent empty is cleared.

const Body = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(254).optional(),
  phone: z.string().max(60).optional(),
})

export async function POST(request: NextRequest) {
  const conversation = await visitorConversation(request)
  if (!conversation) return errorResponse('Chat not found', 404)
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Those details could not be read.')
  const { name: rawName, email: rawEmail, phone: rawPhone } = parsed.data
  if (rawName === undefined && rawEmail === undefined && rawPhone === undefined) return errorResponse('There is nothing to save.')

  const email = rawEmail?.trim() ? cleanEmail(rawEmail) : null
  if (rawEmail?.trim() && !email) return errorResponse('That email address does not look quite right.')
  const phone = rawPhone?.trim() ? cleanPhone(rawPhone) : null
  if (rawPhone?.trim() && !phone) return errorResponse('That phone number does not look quite right.')
  const name = cleanName(rawName)

  await replaceVisitorDetails(conversation.id, {
    name: rawName === undefined ? undefined : name,
    email: rawEmail === undefined ? undefined : email,
    phone: rawPhone === undefined ? undefined : phone,
  })
  // The Unified Inbox keeps its own copy of the chat, and would otherwise only
  // learn the name on the visitor's next message or its next timed collection.
  after(() => announce(conversation.id))
  return NextResponse.json({ ok: true, name, email, phone }, { headers: { 'Cache-Control': 'no-store' } })
}

import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { createConversation, deleteConversations } from '@/modules/chat/lib/db'
import { getVisitor, getVisitorTokenHash, openChatWithVisitor } from '@/modules/chat/lib/visitors'
import { newConversationId } from '@/modules/chat/lib/visitor'
import { messageBody, readMessageForm } from '@/modules/chat/lib/form'
import { filesProblem } from '@/modules/chat/lib/text'
import { ChatEndedError, sendAgentReply } from '@/modules/chat/lib/reply'
import { StorageUnavailableError } from '@/modules/chat/lib/attachments'
import { clientMessage } from '@/modules/chat/lib/serialise'
import { PERM_REPLY } from '@/modules/chat/lib/constants'

type Params = { params: Promise<{ id: string }> }

// Saying hello first. A visitor already in an open chat with us gets the message
// in that chat; anybody else gets a new one, claimed by their browser with the
// secret it already holds for its visitor row, which it picks up on its next
// check-in (within half a minute while the tab is in front).
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requirePermission(PERM_REPLY)
  if ('response' in auth) return auth.response
  const { id } = await params
  const visitor = await getVisitor(id)
  const tokenHash = visitor ? await getVisitorTokenHash(id) : null
  if (!visitor || !tokenHash) return errorResponse('That visitor has left and taken their trail with them.', 404)

  const form = await readMessageForm(request)
  if (!form) return errorResponse('That message could not be read.')
  const body = messageBody(form.fields.body)
  if (!body && form.files.length === 0) return errorResponse('There is nothing to send.')
  const problem = filesProblem(form.files)
  if (problem) return errorResponse(problem)

  let conversationId = await openChatWithVisitor(id)
  let created = false
  if (!conversationId) {
    conversationId = newConversationId()
    await createConversation({
      id: conversationId,
      tokenHash,
      name: null,
      email: null,
      pageUrl: visitor.currentPath,
      ipHash: null,
      visitorId: id,
      startedBy: 'agent',
    })
    created = true
  }

  try {
    const message = await sendAgentReply(conversationId, auth.user.id, body, form.files)
    return NextResponse.json({ conversationId, message: clientMessage(message, false) })
  } catch (err) {
    // A chat that never got its first message is not a chat.
    if (created) await deleteConversations([conversationId])
    if (err instanceof StorageUnavailableError) return errorResponse(err.message, 503)
    if (err instanceof ChatEndedError) return errorResponse(err.message, 409)
    console.error('[chat] could not start a chat', err)
    return errorResponse('That message could not be sent. Please try again.', 502)
  }
}

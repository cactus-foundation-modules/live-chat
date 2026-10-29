import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { getConversation } from '@/modules/chat/lib/db'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { messageBody, readMessageForm } from '@/modules/chat/lib/form'
import { filesProblem } from '@/modules/chat/lib/text'
import { ChatEndedError, sendAgentReply } from '@/modules/chat/lib/reply'
import { StorageUnavailableError } from '@/modules/chat/lib/attachments'
import { clientMessages } from '@/modules/chat/lib/serialise'
import { PERM_REPLY } from '@/modules/chat/lib/constants'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(PERM_REPLY)
  if ('response' in auth) return auth.response
  const { id } = await params
  const conversation = await getConversation(id)
  if (!conversation) return errorResponse('That chat could not be found.', 404)
  if (conversation.status === 'closed') return errorResponse(new ChatEndedError().message, 409)

  const form = await readMessageForm(request)
  if (!form) return errorResponse('That message could not be read.')
  const body = messageBody(form.fields.body)
  if (!body && form.files.length === 0) return errorResponse('There is nothing to send.')
  const problem = filesProblem(form.files)
  if (problem) return errorResponse(problem)

  try {
    const message = await sendAgentReply(id, auth.user.id, body, form.files)
    const [sent] = await clientMessages([message], false)
    return NextResponse.json({ message: sent })
  } catch (err) {
    if (err instanceof StorageUnavailableError) return errorResponse(err.message, 503)
    if (err instanceof ChatEndedError) return errorResponse(err.message, 409)
    console.error('[chat] reply failed', err)
    return errorResponse('That reply could not be sent. Please try again.', 502)
  }
}

import { after, NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import {
  deleteConversations,
  getConversation,
  insertMessage,
  listMessages,
  markReadByAgents,
  setStatus,
  storedFilesFor,
} from '@/modules/chat/lib/db'
import { requirePermission } from '@/modules/chat/lib/admin-auth'
import { clientConversation, clientMessage, clientVisitor } from '@/modules/chat/lib/serialise'
import { getVisitor } from '@/modules/chat/lib/visitors'
import { deleteStoredFiles } from '@/modules/chat/lib/attachments'
import { agentName } from '@/modules/chat/lib/agent'
import { announce, syncAgentAlert } from '@/modules/chat/lib/notify'
import { PERM_MANAGE, PERM_REPLY, PERM_VIEW } from '@/modules/chat/lib/constants'

type Params = { params: Promise<{ id: string }> }

// One chat for the admin: what is new since the last message they hold, and
// marked read when they are actually looking at it.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requirePermission(PERM_VIEW)
  if ('response' in auth) return auth.response
  const { id } = await params
  const conversation = await getConversation(id)
  if (!conversation) return errorResponse('That chat could not be found.', 404)

  const afterId = Math.max(0, Number(request.nextUrl.searchParams.get('after') ?? 0) || 0)
  const [messages, visitor] = await Promise.all([
    listMessages(id, afterId),
    // Where they are and what is in their basket, when they agreed to be listed.
    conversation.visitorId ? getVisitor(conversation.visitorId).catch(() => null) : Promise.resolve(null),
  ])
  if (request.nextUrl.searchParams.get('read') === '1' && conversation.unreadForAgents > 0) {
    await markReadByAgents(id)
    after(syncAgentAlert)
  }
  return NextResponse.json(
    {
      conversation: clientConversation(conversation),
      messages: messages.map((m) => clientMessage(m, false)),
      visitor: visitor ? clientVisitor(visitor) : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// End a chat. There is no reopening: once a chat has ended, nobody can add to
// it, so the visitor is never surprised by a message in a chat they closed.
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requirePermission(PERM_REPLY)
  if ('response' in auth) return auth.response
  const { id } = await params
  const conversation = await getConversation(id)
  if (!conversation) return errorResponse('That chat could not be found.', 404)

  const body = (await request.json().catch(() => null)) as { status?: unknown } | null
  if (body?.status !== 'closed') return errorResponse('A chat can only be ended, not reopened.')
  if (conversation.status !== 'closed') {
    const name = await agentName(auth.user.id)
    await insertMessage({ conversationId: id, sender: 'system', body: `${name ?? 'We'} ended the chat.` })
    await setStatus(id, 'closed')
    await markReadByAgents(id)
    after(async () => {
      await syncAgentAlert()
      await announce(id)
    })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requirePermission(PERM_MANAGE)
  if ('response' in auth) return auth.response
  const { id } = await params
  const files = await storedFilesFor([id])
  await deleteConversations([id])
  after(async () => {
    await deleteStoredFiles(files)
    await syncAgentAlert()
  })
  return NextResponse.json({ ok: true })
}

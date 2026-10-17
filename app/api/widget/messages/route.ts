import { after, NextRequest, NextResponse } from 'next/server'
import { getClientIp } from '@/lib/auth/rate-limit'
import { errorResponse } from '@/lib/utils'
import { getChatSettings } from '@/modules/chat/lib/settings'
import {
  countConversationsFromIp,
  countVisitorMessages,
  createConversation,
  deleteConversations,
  insertMessage,
  listMessages,
  markReadByVisitor,
  setVisitorDetails,
  stampTyping,
} from '@/modules/chat/lib/db'
import { hashIp, hashSecret, newConversationId, newSecret, visitorConversation } from '@/modules/chat/lib/visitor'
import { messageBody, readMessageForm } from '@/modules/chat/lib/form'
import { cleanEmail, cleanName, filesProblem } from '@/modules/chat/lib/text'
import { storeFiles, StorageUnavailableError } from '@/modules/chat/lib/attachments'
import { announce, syncAgentAlert } from '@/modules/chat/lib/notify'
import { clientMessage } from '@/modules/chat/lib/serialise'
import { getConsentState, mayChat } from '@/modules/chat/lib/consent'
import { linkConversationToVisitor, visitorFromRequest } from '@/modules/chat/lib/visitors'
import { CONSENT_CATEGORY } from '@/modules/chat/lib/constants'

// The visitor's side of a chat: read what is new, and say something.

const NEW_CHATS_PER_HOUR = 5
const MESSAGES_PER_MINUTE = 20

export async function GET(request: NextRequest) {
  const conversation = await visitorConversation(request)
  if (!conversation) return errorResponse('Chat not found', 404)

  const afterId = Math.max(0, Number(request.nextUrl.searchParams.get('after') ?? 0) || 0)
  const messages = await listMessages(conversation.id, afterId)
  // "seen" is sent while the chat window is actually open, so replies that
  // arrive while it is closed still count as unread on the bubble.
  if (request.nextUrl.searchParams.get('seen') === '1' && conversation.unreadForVisitor > 0) {
    await markReadByVisitor(conversation.id)
  }
  // They have been typing since their last ask: the admin's next ask shows it.
  if (request.nextUrl.searchParams.get('typing') === '1' && conversation.status === 'open') {
    await stampTyping(conversation.id, 'visitor')
  }
  const { online } = await getChatSettings()
  return NextResponse.json(
    {
      online,
      status: conversation.status,
      unread: conversation.unreadForVisitor,
      // Whoever on our side is typing: their name, '' when unnamed, null when nobody.
      typing: conversation.agentTyping,
      messages: messages.map((m) => clientMessage(m, true)),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const [settings, consent] = await Promise.all([getChatSettings(), getConsentState()])
  if (!settings.enabled) return errorResponse('Chat is switched off at the moment.', 403)
  // The widget asks first; this is for anything that did not.
  if (!mayChat(request, consent.gate)) {
    return NextResponse.json(
      { error: 'Live chat needs your OK on our cookie settings first.', needsConsent: CONSENT_CATEGORY },
      { status: 403 },
    )
  }

  const form = await readMessageForm(request)
  if (!form) return errorResponse('That message could not be read.')
  const body = messageBody(form.fields.body)
  if (!body && form.files.length === 0) return errorResponse('There is nothing to send.')
  const problem = filesProblem(form.files)
  if (problem) return errorResponse(problem)

  const conversation = await visitorConversation(request)
  let conversationId: string
  let claim: string | null = null

  if (!conversation) {
    const ipHash = hashIp(await getClientIp(request))
    if (await countConversationsFromIp(ipHash, new Date(Date.now() - 60 * 60 * 1000)) >= NEW_CHATS_PER_HOUR) {
      return errorResponse('Too many new chats from here - please try again in a little while.', 429)
    }
    const id = newConversationId()
    const secret = newSecret()
    const page = (form.fields.page ?? '').slice(0, 500)
    await createConversation({
      id,
      tokenHash: hashSecret(secret),
      name: cleanName(form.fields.name),
      email: cleanEmail(form.fields.email),
      pageUrl: page.startsWith('/') ? page : null,
      ipHash,
    })
    claim = `${id}.${secret}`
    conversationId = id
    // A visitor already on the visitor list: their chat shows where they are.
    const visitor = await visitorFromRequest(request).catch(() => null)
    if (visitor) await linkConversationToVisitor(id, visitor.id)
  } else {
    conversationId = conversation.id
    if (await countVisitorMessages(conversation.id, new Date(Date.now() - 60 * 1000)) >= MESSAGES_PER_MINUTE) {
      return errorResponse('Slow down a touch - please wait a moment before sending more.', 429)
    }
    const name = cleanName(form.fields.name)
    const email = cleanEmail(form.fields.email)
    if (name || email) await setVisitorDetails(conversation.id, { name, email })
  }

  let attachments
  try {
    attachments = await storeFiles(conversationId, form.files)
  } catch (err) {
    // A chat that never got its first message is not a chat.
    if (claim) await deleteConversations([conversationId])
    if (err instanceof StorageUnavailableError) return errorResponse(err.message, 503)
    console.error('[chat] attachment upload failed', err)
    return errorResponse('That file could not be uploaded. Please try again.', 502)
  }

  const message = await insertMessage({ conversationId, sender: 'visitor', body, attachments })
  after(async () => {
    await syncAgentAlert()
    await announce(conversationId)
  })

  return NextResponse.json({ claim, message: clientMessage(message, true) })
}

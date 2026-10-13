import { after, NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { getChatSettings } from '@/modules/chat/lib/settings'
import { claimTranscript, insertMessage, listMessages, releaseTranscript, setPushSubscription, setStatus, setVisitorDetails } from '@/modules/chat/lib/db'
import { visitorConversation } from '@/modules/chat/lib/visitor'
import { cleanEmail } from '@/modules/chat/lib/text'
import { sendTranscript } from '@/modules/chat/lib/transcript'
import { announce, syncAgentAlert } from '@/modules/chat/lib/notify'

// The visitor ends the chat, optionally asking for a copy by email. The email
// goes first: a chat that closed but could not send its transcript would leave
// the visitor with nothing and no way to ask again.
export async function POST(request: NextRequest) {
  const conversation = await visitorConversation(request)
  if (!conversation) return errorResponse('Chat not found', 404)

  const input = (await request.json().catch(() => ({}))) as { transcript?: unknown; email?: unknown }
  let emailed: string | null = null

  if (input.transcript === true) {
    const settings = await getChatSettings()
    if (!settings.transcripts) return errorResponse('Transcripts are not available on this site.', 403)
    const email = cleanEmail(input.email) ?? conversation.visitorEmail
    if (!email) return errorResponse('Please give us an email address to send the transcript to.')
    if (await claimTranscript(conversation.id)) {
      try {
        await sendTranscript(email, conversation, await listMessages(conversation.id))
        emailed = email
      } catch (err) {
        await releaseTranscript(conversation.id)
        console.error('[chat] transcript email failed', err)
        return errorResponse('The transcript could not be emailed just now. Please try again.', 502)
      }
      if (email !== conversation.visitorEmail) await setVisitorDetails(conversation.id, { email })
    } else {
      emailed = email
    }
  }

  if (conversation.status !== 'closed') {
    await insertMessage({ conversationId: conversation.id, sender: 'system', body: 'The visitor ended the chat.' })
    await setStatus(conversation.id, 'closed')
  }
  await setPushSubscription(conversation.id, null)

  after(async () => {
    await syncAgentAlert()
    await announce(conversation.id)
  })
  return NextResponse.json({ ok: true, emailed })
}

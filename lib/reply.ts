import { after } from 'next/server'
import { getConversation, insertMessage, markReadByAgents, type ChatMessage } from './db'
import { agentName } from './agent'
import { announce, pushToVisitor, syncAgentAlert } from './notify'
import { storeFiles } from './attachments'
import { withoutLinks } from './links'

/** Thrown when a colleague tries to reply to a chat that has ended. */
export class ChatEndedError extends Error {
  constructor() {
    super('This chat has ended, so it cannot take any more messages.')
  }
}

/** One reply from a colleague, from wherever they typed it: the admin inbox,
 *  the bubble on the site, or the Unified Inbox. An ended chat stays ended:
 *  the visitor has said goodbye, and a reply would quietly reopen it. */
export async function sendAgentReply(conversationId: string, userId: string, body: string, files: File[] = []): Promise<ChatMessage> {
  const conversation = await getConversation(conversationId)
  if (!conversation) throw new Error('That chat could not be found.')
  if (conversation.status === 'closed') throw new ChatEndedError()
  const name = await agentName(userId)
  const attachments = await storeFiles(conversationId, files)
  const message = await insertMessage({ conversationId, sender: 'agent', authorUserId: userId, authorName: name, body, attachments })
  await markReadByAgents(conversationId)
  after(async () => {
    await pushToVisitor(conversationId, name, withoutLinks(body) || (attachments[0] ? `Sent you ${attachments[0].filename}` : ''))
    await syncAgentAlert()
    await announce(conversationId)
  })
  return message
}

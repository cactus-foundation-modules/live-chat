import { after } from 'next/server'
import { insertMessage, markReadByAgents, type ChatMessage } from './db'
import { agentName } from './agent'
import { announce, pushToVisitor, syncAgentAlert } from './notify'
import { storeFiles } from './attachments'

/** One reply from a colleague, from wherever they typed it: the admin inbox,
 *  the bubble on the site, or the Unified Inbox. */
export async function sendAgentReply(conversationId: string, userId: string, body: string, files: File[] = []): Promise<ChatMessage> {
  const name = await agentName(userId)
  const attachments = await storeFiles(conversationId, files)
  const message = await insertMessage({ conversationId, sender: 'agent', authorUserId: userId, authorName: name, body, attachments })
  await markReadByAgents(conversationId)
  after(async () => {
    await pushToVisitor(conversationId, name, body || (attachments[0] ? `Sent you ${attachments[0].filename}` : ''))
    await syncAgentAlert()
    await announce(conversationId)
  })
  return message
}

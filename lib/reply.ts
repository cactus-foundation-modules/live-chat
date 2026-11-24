import { getConversation, insertMessage, markReadByAgents, setStatus, type ChatMessage } from './db'
import { agentName } from './agent'
import { announce, pushToVisitor, syncAgentAlert } from './notify'
import { storeFiles } from './attachments'
import { withoutLinks } from './links'
import { tellResponderColleagueReplied } from './responder'
import { later } from './later'

/** Thrown when a colleague tries to reply to a chat that has ended. */
export class ChatEndedError extends Error {
  constructor() {
    super('This chat has ended, so it cannot take any more messages.')
  }
}

/**
 * One message from our side, by whoever wrote it: a colleague (sendAgentReply)
 * or another module answering chats (lib/responder-api.ts). Saves it with its
 * files, which counts it unread for the visitor and clears our "typing…", then
 * pushes it to the visitor's browser, settles the bell and tells the Unified
 * Inbox. An ended chat stays ended: the visitor has said goodbye, and a message
 * would quietly reopen it.
 *
 * `markRead` is for a colleague: somebody replying has plainly read the chat.
 * A module's message leaves the unread count alone, so a chat it has just
 * handed to a colleague stays waiting for one.
 */
export async function postAgentMessage(conversationId: string, message: {
  authorUserId: string
  authorName: string | null
  body: string
  files?: File[]
  markRead: boolean
}): Promise<ChatMessage> {
  const conversation = await getConversation(conversationId)
  if (!conversation) throw new Error('That chat could not be found.')
  if (conversation.status === 'closed') throw new ChatEndedError()
  const { authorUserId, authorName, body } = message
  const attachments = await storeFiles(conversationId, message.files ?? [])
  const saved = await insertMessage({ conversationId, sender: 'agent', authorUserId, authorName, body, attachments })
  if (message.markRead) await markReadByAgents(conversationId)
  later(async () => {
    await pushToVisitor(conversationId, authorName, withoutLinks(body) || (attachments[0] ? `Sent you ${attachments[0].filename}` : ''))
    await syncAgentAlert()
    await announce(conversationId)
  })
  return saved
}

/** One reply from a colleague, from wherever they typed it: the admin inbox,
 *  the bubble on the site, the visitor list, or the Unified Inbox. A module
 *  answering chats hears about it afterwards, never holding the reply up. */
export async function sendAgentReply(conversationId: string, userId: string, body: string, files: File[] = []): Promise<ChatMessage> {
  const name = await agentName(userId)
  const message = await postAgentMessage(conversationId, { authorUserId: userId, authorName: name, body, files, markRead: true })
  later(() => tellResponderColleagueReplied({ conversationId, userId }))
  return message
}

/** Ends an open chat from our side: a line saying who ended it, closed, read,
 *  and the bell and the Unified Inbox told. The caller has checked it is open. */
export async function closeChatAsAgent(conversationId: string, name: string | null): Promise<void> {
  await insertMessage({ conversationId, sender: 'system', body: `${name ?? 'We'} ended the chat.` })
  await setStatus(conversationId, 'closed')
  await markReadByAgents(conversationId)
  later(async () => {
    await syncAgentAlert()
    await announce(conversationId)
  })
}

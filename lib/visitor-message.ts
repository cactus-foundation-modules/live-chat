import { addUnreadForAgents, type ChatMessage } from './db'
import { sendOfflineNoticeIfDue } from './offline-notice'
import { offerVisitorMessage, type ResponderContract } from './responder'
import type { ChatSettings } from './settings'

// What happens to a visitor's message once it is saved, before the visitor's
// own answer goes back.
//
// With no responder installed (lib/responder.ts) this is what it always was:
// the message was counted unread for agents as it was saved, and the offline
// reply goes if one is owed.
//
// With a responder, the message was saved without being counted (the route
// passes `countUnread: false`), so nothing shows it waiting on a colleague -
// no bell, no chime in the admin list - while the responder is asked. Then:
// - taken: the responder is answering. Nothing is counted, no offline reply
//   goes, and the chat is left for it. A colleague it asked for earlier stays
//   asked for: taking a message does not cancel that.
// - not taken (a no, a throw, a timeout, a nonsense answer): counted now, and
//   the ordinary flow runs, offline reply and all.

export type SettledVisitorMessage = { taken: boolean; notice: ChatMessage | null }

export async function settleVisitorMessage(
  responder: ResponderContract | null,
  message: { conversationId: string; messageId: number; visitorId: string | null; newConversation: boolean },
  settings: ChatSettings,
  contact: { email: string | null; phone: string | null },
): Promise<SettledVisitorMessage> {
  const { conversationId } = message
  if (responder) {
    const taken = await offerVisitorMessage(responder, { ...message, online: settings.online })
    if (taken) return { taken: true, notice: null }
    await addUnreadForAgents(conversationId)
  }
  return { taken: false, notice: await sendOfflineNoticeIfDue(conversationId, settings, contact) }
}

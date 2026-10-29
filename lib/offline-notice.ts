import { prisma } from '@/lib/db/prisma'
import { insertMessage, type ChatMessage } from './db'
import type { ChatSettings } from './settings'

// The note a visitor gets when they write again after we have gone offline part
// way through their chat.
//
// "Part way through" is the whole test: a colleague has replied in this chat,
// and nobody is answering now. A chat that started while we were away already
// opened on the away message and needs no second one. Once per offline spell -
// it is owed again only after a colleague has replied since the last one, so a
// visitor sending five messages into the evening gets one note, not five.

/** What we will do about replying, said in the visitor's terms: where we will
 *  answer them if we can, or what to leave so that we can. */
export function offlineNoticeText(
  message: string,
  contact: { email: string | null; phone: string | null },
): string {
  const opening = message.trim()
  if (contact.email) return `${opening} We will reply to you at ${contact.email} as soon as we are back.`
  if (contact.phone) return `${opening} We will get back to you on ${contact.phone} as soon as we are back.`
  return `${opening} If you leave your email address or phone number in the box at the top of this chat, we will get back to you as soon as we are back.`
}

/** Claims the note for this chat, or says it is not owed. One conditional
 *  UPDATE, so two messages arriving together cannot both earn one. */
async function claimOfflineNotice(conversationId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "chat_conversations" c
       SET "offline_notice_at" = now()
     WHERE c."id" = ${conversationId}
       AND c."status" = 'open'
       AND EXISTS (
         SELECT 1 FROM "chat_messages" m
          WHERE m."conversation_id" = c."id"
            AND m."sender" = 'agent'
            AND m."author_user_id" IS NOT NULL
            AND (c."offline_notice_at" IS NULL OR m."created_at" > c."offline_notice_at")
       )
    RETURNING c."id"
  `
  return rows.length > 0
}

/**
 * Sends the note when it is owed, and hands it back so the visitor's own
 * answer can carry it straight away. Never throws: the visitor's message is
 * already safe, and a note that fails to go is a note, not a lost message.
 */
export async function sendOfflineNoticeIfDue(
  conversationId: string,
  settings: ChatSettings,
  contact: { email: string | null; phone: string | null },
): Promise<ChatMessage | null> {
  if (settings.online || !settings.offlineNoticeEnabled) return null
  try {
    if (!await claimOfflineNotice(conversationId)) return null
    return await insertMessage({
      conversationId,
      sender: 'agent',
      authorName: settings.autoMessageAuthor,
      body: offlineNoticeText(settings.offlineNoticeMessage, contact),
    })
  } catch (err) {
    console.error('[chat] could not send the offline note', err)
    return null
  }
}

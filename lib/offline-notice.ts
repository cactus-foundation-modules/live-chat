import { prisma } from '@/lib/db/prisma'
import { insertMessage, type ChatMessage } from './db'
import { pushToVisitor, announce } from './notify'
import type { ChatSettings } from './settings'
import { RESPONDER_AUTHOR_PREFIX } from './constants'

// The automatic reply a visitor gets when they write to us while we are
// offline. Two wordings: the away reply for a chat nobody has answered yet (a
// brand new one included - the away greeting in the window header is easy to
// miss and never reaches the chat itself), and the offline note for a chat a
// colleague was answering before we stepped away.
//
// Once per offline spell. It is owed again only when the visitor has written
// since the last one AND something has changed since: a colleague has
// replied, or the switch has gone off again. A visitor sending five messages
// into the evening gets one reply, not five.
//
// Not while somebody is plainly answering with the switch left off: a
// colleague's reply in this chat within the last few minutes, sent after the
// switch went off, says a person is here.

/** How recent a colleague's reply, sent while the switch was off, has to be
 *  for us to take it that somebody is answering anyway. */
const ANSWERING_ANYWAY_MS = 10 * 60 * 1000

/** Chats left waiting when the switch goes off get the reply then, if the
 *  visitor wrote this recently. Older than that, they hear when they next write. */
const WAITING_WINDOW_HOURS = 24
const WAITING_SWEEP_LIMIT = 50

type Contact = { email: string | null; phone: string | null }

/** What we will do about replying, said in the visitor's terms: where we will
 *  answer them if we can, or what to leave so that we can. */
export function offlineNoticeText(message: string, contact: Contact): string {
  const opening = message.trim()
  if (contact.email) return `${opening} We will reply to you at ${contact.email} as soon as we are back.`
  if (contact.phone) return `${opening} We will get back to you on ${contact.phone} as soon as we are back.`
  return `${opening} If you leave your email address or phone number in the box at the top of this chat, we will get back to you as soon as we are back.`
}

/** Claims the reply for this chat, or says it is not owed. One conditional
 *  UPDATE, so two messages arriving together cannot both earn one. Says
 *  whether a colleague has ever answered the chat, which picks the wording. */
async function claimOfflineNotice(conversationId: string, offlineSince: Date | null): Promise<{ answered: boolean } | null> {
  const rows = await prisma.$queryRaw<{ answered: boolean }[]>`
    UPDATE "chat_conversations" c
       SET "offline_notice_at" = now()
     WHERE c."id" = ${conversationId}
       AND c."status" = 'open'
       -- They have written since the last one: it answers them, never nobody.
       AND EXISTS (
         SELECT 1 FROM "chat_messages" v
          WHERE v."conversation_id" = c."id"
            AND v."sender" = 'visitor'
            AND (c."offline_notice_at" IS NULL OR v."created_at" > c."offline_notice_at")
       )
       -- Never had one, or one of us has replied since, or this is a new spell.
       AND (
         c."offline_notice_at" IS NULL
         OR (${offlineSince}::timestamptz IS NOT NULL AND c."offline_notice_at" < ${offlineSince}::timestamptz)
         OR EXISTS (
           SELECT 1 FROM "chat_messages" m
            WHERE m."conversation_id" = c."id"
              AND m."sender" = 'agent'
              AND m."author_user_id" IS NOT NULL
              AND m."created_at" > c."offline_notice_at"
         )
       )
       -- Nobody is answering with the switch left off. A module answering
       -- chats (author "module:...") is not somebody: it either takes the
       -- message, and this is never asked, or it has stopped, and we are away.
       AND NOT EXISTS (
         SELECT 1 FROM "chat_messages" m
          WHERE m."conversation_id" = c."id"
            AND m."sender" = 'agent'
            AND m."author_user_id" IS NOT NULL
            AND m."author_user_id" NOT LIKE ${RESPONDER_AUTHOR_PREFIX + '%'}
            AND m."created_at" > now() - make_interval(secs => ${ANSWERING_ANYWAY_MS / 1000}::int4)
            AND (${offlineSince}::timestamptz IS NULL OR m."created_at" > ${offlineSince}::timestamptz)
       )
    RETURNING EXISTS (
      SELECT 1 FROM "chat_messages" m
       WHERE m."conversation_id" = c."id"
         AND m."sender" = 'agent'
         AND m."author_user_id" IS NOT NULL
    ) AS answered
  `
  const row = rows[0]
  return row ? { answered: row.answered } : null
}

/**
 * Who the reply goes out as. In a chat another module's assistant has been
 * answering, its name, so it reads as the assistant
 * stepping aside, not as a person: learned on a live site, where it went out
 * under the owner's chosen name ("Sarah"), as though a colleague who was not
 * there had written. Otherwise the owner's chosen name, as always. Never the
 * assistant's author id: the notice is the site's, not something the
 * assistant said, and must not read back to it as its own turn.
 */
async function noticeAuthor(conversationId: string, settings: ChatSettings): Promise<string> {
  const rows = await prisma.$queryRaw<{ author_name: string | null; author_user_id: string | null }[]>`
    SELECT m."author_name", m."author_user_id" FROM "chat_messages" m
     WHERE m."conversation_id" = ${conversationId} AND m."sender" = 'agent'
       AND m."author_user_id" LIKE ${`${RESPONDER_AUTHOR_PREFIX}%`}
     ORDER BY m."id" DESC LIMIT 1
  `
  return rows[0]?.author_name?.trim() || settings.autoMessageAuthor
}

/**
 * Sends the reply when it is owed, and hands it back so the visitor's own
 * answer can carry it straight away. Never throws: the visitor's message is
 * already safe, and a reply that fails to go is a reply, not a lost message.
 */
export async function sendOfflineNoticeIfDue(
  conversationId: string,
  settings: ChatSettings,
  contact: Contact,
): Promise<ChatMessage | null> {
  if (settings.online || !settings.offlineNoticeEnabled) return null
  try {
    const claimed = await claimOfflineNotice(conversationId, settings.offlineSince)
    if (!claimed) return null
    return await insertMessage({
      conversationId,
      sender: 'agent',
      authorName: await noticeAuthor(conversationId, settings),
      body: offlineNoticeText(claimed.answered ? settings.offlineNoticeMessage : settings.awayReplyMessage, contact),
    })
  } catch (err) {
    console.error('[chat] could not send the offline reply', err)
    return null
  }
}

/**
 * The switch has just gone off: every open chat with a visitor still waiting
 * on us hears now, rather than only when they next write. Pushed to the
 * visitor's browser too, since most will not have the chat open. Returns how
 * many were told.
 */
export async function tellWaitingVisitorsWeAreOffline(settings: ChatSettings): Promise<number> {
  if (settings.online || !settings.offlineNoticeEnabled || !settings.enabled) return 0
  const waiting = await prisma.$queryRaw<{ id: string; visitor_email: string | null; visitor_phone: string | null }[]>`
    SELECT c."id", c."visitor_email", c."visitor_phone"
      FROM "chat_conversations" c
     WHERE c."status" = 'open'
       AND c."last_message_at" > now() - make_interval(hours => ${WAITING_WINDOW_HOURS}::int4)
       AND (
         SELECT m."sender" FROM "chat_messages" m
          WHERE m."conversation_id" = c."id" AND m."sender" <> 'system'
          ORDER BY m."id" DESC LIMIT 1
       ) = 'visitor'
     ORDER BY c."last_message_at" DESC
     LIMIT ${WAITING_SWEEP_LIMIT}
  `
  let told = 0
  for (const chat of waiting) {
    const notice = await sendOfflineNoticeIfDue(chat.id, settings, { email: chat.visitor_email, phone: chat.visitor_phone })
    if (!notice) continue
    told += 1
    await pushToVisitor(chat.id, notice.authorName ?? settings.autoMessageAuthor, notice.body)
    await announce(chat.id).catch((err: unknown) => console.error('[chat] could not announce the offline reply', err))
  }
  return told
}

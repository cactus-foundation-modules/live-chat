import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  connectionUri,
  createTestDatabase,
  createTestRole,
  dropStaleTestObjects,
  dropTestDatabase,
  dropTestRole,
  testServerFromEnv,
  type TestRole,
  type TestServer,
} from '@/lib/backup/test-database'
import type { ChatSettings } from './settings'

// The note a visitor gets when we went offline part way through their chat,
// against a real Postgres. Once per offline spell rests on one conditional
// UPDATE that tsc, eslint and the build gate never execute, and the chat staying
// "waiting" afterwards rests on the list query telling a colleague's reply from
// an automatic one.
//
// Gated like the other live suites: it needs the OVH server, makes cactus_rt_*
// databases and drops them afterwards.
const ENABLED = process.env.RUN_LEDGER_GUARDS === '1' || process.env.RUN_BACKUP_ROUNDTRIP === '1'
if (ENABLED) {
  try {
    ;(process as unknown as { loadEnvFile: (path: string) => void }).loadEnvFile('.env')
  } catch {
    // No .env - testServerFromEnv below fails the suite loudly rather than here.
  }
}
const suite = ENABLED ? describe : describe.skip

suite('the offline note, against a real database', () => {
  let server: TestServer
  let role: TestRole
  let client: Client
  const databaseName = `cactus_rt_chatoffline_${process.pid}`
  const roleName = `cactus_rt_role_chatoffline_${process.pid}`

  // Imported after DATABASE_URL is set, because lib/db/prisma reads it when the
  // client is built.
  let db: typeof import('./db')
  let notice: typeof import('./offline-notice')

  // Built once settings.ts can be imported - it pulls the database client in.
  let offline: ChatSettings
  const nobody = { email: null, phone: null }

  async function chat(id: string): Promise<void> {
    await db.createConversation({ id, tokenHash: 'x'.repeat(64), name: null, email: null, pageUrl: '/', ipHash: null })
  }

  beforeAll(async () => {
    server = testServerFromEnv()
    await dropStaleTestObjects(server)
    role = await createTestRole(server, roleName)
    await createTestDatabase(server, databaseName, role)

    const uri = connectionUri(server, databaseName, role)
    client = new Client({ connectionString: `${uri}&uselibpqcompat=true` })
    await client.connect()

    // Every migration in order, run twice, so the numbered files are proven
    // idempotent on top of themselves as well.
    const directory = join(__dirname, '..', 'migrations')
    const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
    for (const pass of [1, 2]) {
      for (const file of files) await client.query(readFileSync(join(directory, file), 'utf8')).catch((err: unknown) => {
        throw new Error(`${file} (pass ${pass}): ${String(err)}`)
      })
    }

    process.env.DATABASE_URL = uri
    db = await import('./db')
    notice = await import('./offline-notice')
    offline = { ...(await import('./settings')).DEFAULT_SETTINGS, online: false }
  }, 120_000)

  afterAll(async () => {
    await import('@/lib/db/prisma')
      .then((module) => module.prisma.$disconnect())
      .catch(() => undefined)
    await client?.end().catch(() => undefined)
    if (server) {
      await dropTestDatabase(server, databaseName).catch(() => undefined)
      await dropTestRole(server, roleName).catch(() => undefined)
    }
  }, 120_000)

  /** A colleague's reply, written as if it was sent `minutesAgo` minutes ago. */
  async function colleagueReply(id: string, body: string, minutesAgo: number): Promise<void> {
    const sent = await db.insertMessage({ conversationId: id, sender: 'agent', authorUserId: 'u1', authorName: 'Sam', body })
    await client.query(`UPDATE "chat_messages" SET "created_at" = now() - make_interval(mins => $1) WHERE "id" = $2`, [minutesAgo, sent.id])
  }

  it('gives a brand new chat the away reply, once', async () => {
    await chat('chat-new')
    await db.insertMessage({ conversationId: 'chat-new', sender: 'visitor', body: 'Hello?' })
    const first = await notice.sendOfflineNoticeIfDue('chat-new', offline, { email: 'new@b.test', phone: null })
    expect(first?.body).toContain(offline.awayReplyMessage)
    expect(first?.body).toContain('new@b.test')
    expect(await notice.sendOfflineNoticeIfDue('chat-new', offline, nobody)).toBeNull()
    // Writing again, with nobody having answered, earns nothing more.
    await db.insertMessage({ conversationId: 'chat-new', sender: 'visitor', body: 'Anyone?' })
    expect(await notice.sendOfflineNoticeIfDue('chat-new', offline, nobody)).toBeNull()
  })

  it('treats an automatic welcome as nobody answering', async () => {
    await chat('chat-welcomed')
    await db.insertMessage({ conversationId: 'chat-welcomed', sender: 'agent', authorName: 'Our team', body: 'Welcome!' })
    await db.insertMessage({ conversationId: 'chat-welcomed', sender: 'visitor', body: 'Hi' })
    const sent = await notice.sendOfflineNoticeIfDue('chat-welcomed', offline, nobody)
    expect(sent?.body).toContain(offline.awayReplyMessage)
    expect(sent?.body).toContain('email address or phone number')
  })

  it('says nothing while we are online, or with the reply switched off', async () => {
    await chat('chat-online')
    await db.insertMessage({ conversationId: 'chat-online', sender: 'visitor', body: 'Hi' })
    expect(await notice.sendOfflineNoticeIfDue('chat-online', { ...offline, online: true }, nobody)).toBeNull()
    expect(await notice.sendOfflineNoticeIfDue('chat-online', { ...offline, offlineNoticeEnabled: false }, nobody)).toBeNull()
  })

  it('sends the offline note once per spell, and again after a colleague has replied since', async () => {
    await chat('chat-spell')
    await colleagueReply('chat-spell', 'Hi there', 30)
    await db.insertMessage({ conversationId: 'chat-spell', sender: 'visitor', body: 'Still there?' })

    const first = await notice.sendOfflineNoticeIfDue('chat-spell', offline, nobody)
    expect(first?.sender).toBe('agent')
    expect(first?.body).toContain(offline.offlineNoticeMessage)
    expect(await notice.sendOfflineNoticeIfDue('chat-spell', offline, nobody)).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 20))
    await db.insertMessage({ conversationId: 'chat-spell', sender: 'agent', authorUserId: 'u1', authorName: 'Sam', body: 'Back now' })
    await client.query(`UPDATE "chat_messages" SET "created_at" = now() - interval '15 minutes' WHERE "body" = 'Back now'`)
    await client.query(`UPDATE "chat_conversations" SET "offline_notice_at" = now() - interval '20 minutes' WHERE "id" = 'chat-spell'`)
    await db.insertMessage({ conversationId: 'chat-spell', sender: 'visitor', body: 'Thanks' })
    const second = await notice.sendOfflineNoticeIfDue('chat-spell', offline, { email: 'a@b.test', phone: null })
    expect(second?.body).toContain('a@b.test')
  })

  it('holds back while somebody is answering with the switch left off', async () => {
    const wentOff = new Date(Date.now() - 60 * 60 * 1000)
    await chat('chat-anyway')
    await db.insertMessage({ conversationId: 'chat-anyway', sender: 'visitor', body: 'Question' })
    await colleagueReply('chat-anyway', 'Answer', 5)
    await db.insertMessage({ conversationId: 'chat-anyway', sender: 'visitor', body: 'Follow-up' })
    expect(await notice.sendOfflineNoticeIfDue('chat-anyway', { ...offline, offlineSince: wentOff }, nobody)).toBeNull()
    // The switch going off unknown (before it was recorded) counts the same.
    expect(await notice.sendOfflineNoticeIfDue('chat-anyway', offline, nobody)).toBeNull()
    // Replied, and THEN went offline: they have stepped away, so it is owed.
    const sent = await notice.sendOfflineNoticeIfDue('chat-anyway', { ...offline, offlineSince: new Date() }, nobody)
    expect(sent?.body).toContain(offline.offlineNoticeMessage)
  })

  it('starts again on a new offline spell, but only once they have written', async () => {
    await chat('chat-nights')
    await db.insertMessage({ conversationId: 'chat-nights', sender: 'visitor', body: 'Evening' })
    expect(await notice.sendOfflineNoticeIfDue('chat-nights', offline, nobody)).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The database's clock, not this machine's: the note was stamped by it.
    const tonight = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now ?? new Date()
    // A new spell, but nothing new from them: nothing to answer.
    expect(await notice.sendOfflineNoticeIfDue('chat-nights', { ...offline, offlineSince: tonight }, nobody)).toBeNull()
    await db.insertMessage({ conversationId: 'chat-nights', sender: 'visitor', body: 'Me again' })
    expect(await notice.sendOfflineNoticeIfDue('chat-nights', { ...offline, offlineSince: tonight }, nobody)).not.toBeNull()
  })

  it('records the offline spell on the switch, once', async () => {
    const settings = await import('./settings')
    expect(await settings.setChatOnline(true)).toBeNull()
    expect((await settings.getChatSettings()).offlineSince).toBeNull()
    const wentOff = await settings.setChatOnline(false)
    expect(wentOff).toBeInstanceOf(Date)
    expect((await settings.getChatSettings()).offlineSince?.getTime()).toBe(wentOff?.getTime())
    // Pressing Offline again carries the same spell on.
    expect(await settings.setChatOnline(false)).toBeNull()
    expect((await settings.getChatSettings()).offlineSince?.getTime()).toBe(wentOff?.getTime())
    await settings.setChatOnline(true)
  })

  it('tells the visitors left waiting when the switch goes off, and nobody else', async () => {
    await chat('chat-waiting')
    await db.insertMessage({ conversationId: 'chat-waiting', sender: 'visitor', body: 'Is this in stock?' })
    await chat('chat-answered-last')
    await db.insertMessage({ conversationId: 'chat-answered-last', sender: 'visitor', body: 'Hi' })
    await colleagueReply('chat-answered-last', 'Hello!', 30)
    await client.query(`UPDATE "chat_conversations" SET "offline_notice_at" = now() WHERE "id" <> 'chat-waiting'`)

    const settings = await import('./settings')
    const wentOff = await settings.setChatOnline(false)
    const told = await notice.tellWaitingVisitorsWeAreOffline({ ...offline, offlineSince: wentOff })
    expect(told).toBe(1)
    const rows = await client.query(`SELECT "body" FROM "chat_messages" WHERE "conversation_id" = 'chat-waiting' AND "sender" = 'agent'`)
    expect(rows.rows).toHaveLength(1)
    // Pressed again: nothing new from them, so nothing more.
    expect(await notice.tellWaitingVisitorsWeAreOffline({ ...offline, offlineSince: wentOff })).toBe(0)
    await settings.setChatOnline(true)
  })

  it('leaves the chat waiting for a reply after the note', async () => {
    // "Thanks" came after Sam's "Back now" and was answered only by the note,
    // which is not one of us answering - so it still waits.
    const listed = (await db.listConversations('open')).find((c) => c.id === 'chat-spell')
    expect(listed?.waitingSince).toBeInstanceOf(Date)
    // A colleague's reply is what clears it.
    await db.insertMessage({ conversationId: 'chat-spell', sender: 'agent', authorUserId: 'u1', authorName: 'Sam', body: 'You are welcome' })
    const after = (await db.listConversations('open')).find((c) => c.id === 'chat-spell')
    expect(after?.waitingSince).toBeNull()
  })
})

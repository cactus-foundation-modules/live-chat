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

  it('says nothing in a chat nobody has answered', async () => {
    await chat('chat-unanswered')
    await db.insertMessage({ conversationId: 'chat-unanswered', sender: 'visitor', body: 'Hello?' })
    // An automatic welcome is not one of us answering.
    await db.insertMessage({ conversationId: 'chat-unanswered', sender: 'agent', authorName: 'Our team', body: 'Welcome!' })
    expect(await notice.sendOfflineNoticeIfDue('chat-unanswered', offline, nobody)).toBeNull()
  })

  it('says nothing while we are online, or with the note switched off', async () => {
    await chat('chat-online')
    await db.insertMessage({ conversationId: 'chat-online', sender: 'agent', authorUserId: 'u1', authorName: 'Sam', body: 'Hi' })
    expect(await notice.sendOfflineNoticeIfDue('chat-online', { ...offline, online: true }, nobody)).toBeNull()
    expect(await notice.sendOfflineNoticeIfDue('chat-online', { ...offline, offlineNoticeEnabled: false }, nobody)).toBeNull()
  })

  it('sends once per offline spell, and again after a colleague has replied since', async () => {
    await chat('chat-spell')
    await db.insertMessage({ conversationId: 'chat-spell', sender: 'agent', authorUserId: 'u1', authorName: 'Sam', body: 'Hi there' })
    await db.insertMessage({ conversationId: 'chat-spell', sender: 'visitor', body: 'Still there?' })

    const first = await notice.sendOfflineNoticeIfDue('chat-spell', offline, nobody)
    expect(first?.sender).toBe('agent')
    expect(first?.body).toContain('email address or phone number')
    expect(await notice.sendOfflineNoticeIfDue('chat-spell', offline, nobody)).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 20))
    await db.insertMessage({ conversationId: 'chat-spell', sender: 'agent', authorUserId: 'u1', authorName: 'Sam', body: 'Back now' })
    const second = await notice.sendOfflineNoticeIfDue('chat-spell', offline, { email: 'a@b.test', phone: null })
    expect(second?.body).toContain('a@b.test')
  })

  it('leaves the chat waiting for a reply after the note', async () => {
    const listed = (await db.listConversations('open')).find((c) => c.id === 'chat-spell')
    // The visitor's "Still there?" came after Sam's first reply and was only
    // answered by the note, then by "Back now" - so nothing waits now. Add one
    // more message and the note must not count as its answer.
    expect(listed?.waitingSince).toBeNull()
    await db.insertMessage({ conversationId: 'chat-spell', sender: 'visitor', body: 'Thanks' })
    await notice.sendOfflineNoticeIfDue('chat-spell', offline, nobody)
    const after = (await db.listConversations('open')).find((c) => c.id === 'chat-spell')
    expect(after?.waitingSince).toBeInstanceOf(Date)
  })
})

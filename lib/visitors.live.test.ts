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

// Somebody closing the site, against a real Postgres.
//
// Leaving the visitor list at once rests on three bits of raw SQL that tsc,
// eslint and the build gate never execute: the goodbye that stamps left_at, the
// check-in that clears it again, and the list that leaves stamped rows out.
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

suite('visitors leaving the site, against a real database', () => {
  let server: TestServer
  let role: TestRole
  let client: Client
  const databaseName = `cactus_rt_chatleave_${process.pid}`
  const roleName = `cactus_rt_role_chatleave_${process.pid}`

  // Imported after DATABASE_URL is set, because lib/db/prisma reads it when the
  // client is built.
  let visitors: typeof import('./visitors')

  const id = 'a1b2c3d4e5f6a1b2c3d4e5f6'
  const checkIn = { path: '/desks', title: 'Desks', trail: [], moved: true, cart: undefined }

  async function listedIds(): Promise<string[]> {
    return (await visitors.listOnlineVisitors()).map((v) => v.id)
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
    visitors = await import('./visitors')
    await visitors.createVisitor({ id, tokenHash: 'x'.repeat(64), ipHash: null, device: 'Computer', referrer: null })
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

  it('lists a visitor who has checked in', async () => {
    await visitors.recordCheckIn(id, checkIn)
    expect(await listedIds()).toEqual([id])
    const v = await visitors.getVisitor(id)
    expect(v?.leftAt).toBeNull()
    expect(v && visitors.visitorIsOnline(v)).toBe(true)
  })

  it('drops them the moment they close the site, keeping the row', async () => {
    await visitors.markVisitorLeft(id)
    expect(await listedIds()).toEqual([])
    const v = await visitors.getVisitor(id)
    expect(v?.leftAt).toBeInstanceOf(Date)
    expect(v && visitors.visitorIsOnline(v)).toBe(false)
    expect(v?.currentPath).toBe('/desks')
  })

  it('keeps the first goodbye when a second tab says it too', async () => {
    const first = (await visitors.getVisitor(id))?.leftAt
    await new Promise((resolve) => setTimeout(resolve, 20))
    await visitors.markVisitorLeft(id)
    expect((await visitors.getVisitor(id))?.leftAt).toEqual(first)
  })

  it('puts them back on their next check-in, with or without a basket', async () => {
    await visitors.recordCheckIn(id, checkIn)
    expect(await listedIds()).toEqual([id])

    await visitors.markVisitorLeft(id)
    await visitors.recordCheckIn(id, { ...checkIn, cart: [{ productId: 'p1', name: null, quantity: 1, unitPrice: null }] })
    expect(await listedIds()).toEqual([id])
    expect((await visitors.getVisitor(id))?.leftAt).toBeNull()
  })
})

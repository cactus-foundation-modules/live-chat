import { NextRequest, NextResponse } from 'next/server'
import { getChatSettings } from '@/modules/chat/lib/settings'
import { conversationsOlderThan, deleteConversations, storedFilesFor } from '@/modules/chat/lib/db'
import { deleteStoredFiles } from '@/modules/chat/lib/attachments'
import { pruneVisitors } from '@/modules/chat/lib/visitors'

// Nightly: chats with nothing said in them for longer than the site keeps chats
// are deleted, files first so nothing is left in storage with no row to find it.
// A batch at a time, so a first run over a long backlog cannot outrun the clock.
// Visitor trails go first: one cheap statement, and the one with a promise
// about how long we keep things attached to it.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }
  const visitors = await pruneVisitors().catch((err: unknown) => { console.error('[chat] could not prune visitors', err); return 0 })
  const { retentionMonths } = await getChatSettings()
  let deleted = 0
  const started = Date.now()
  while (Date.now() - started < 40_000) {
    const ids = await conversationsOlderThan(retentionMonths)
    if (ids.length === 0) break
    await deleteStoredFiles(await storedFilesFor(ids))
    deleted += await deleteConversations(ids)
  }
  return NextResponse.json({ ok: true, deleted, visitors })
}

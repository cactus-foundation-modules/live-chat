import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ addUnreadForAgents: vi.fn(async () => true) }))
const notice = vi.hoisted(() => ({ sendOfflineNoticeIfDue: vi.fn(async (): Promise<unknown> => null) }))
vi.mock('./db', () => db)
vi.mock('./offline-notice', () => notice)
vi.mock('@/lib/modules/extension-points.server', () => ({ moduleServerExtensionPointComponents: {} }))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { settleVisitorMessage } from './visitor-message'
import { DEFAULT_SETTINGS } from './settings'
import type { ResponderContract } from './responder'

function responder(taken: unknown): ResponderContract {
  return {
    authorId: 'module:helper',
    offerVisitorMessage: vi.fn(async () => taken),
    answeringAs: vi.fn(async () => null),
    colleagueReplied: vi.fn(async () => undefined),
    onlineChanged: vi.fn(async () => ({ covered: false })),
    messageLabel: vi.fn(async () => null),
  } as ResponderContract
}

const message = { conversationId: 'c1', messageId: 3, visitorId: 'v1', newConversation: false }
const contact = { email: 'sam@example.com', phone: null }
const offline = { ...DEFAULT_SETTINGS, online: false }
const reply = { id: 4, body: 'We are away' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  notice.sendOfflineNoticeIfDue.mockResolvedValue(reply)
})

describe('settleVisitorMessage', () => {
  it('with no responder, is exactly the old flow: the offline reply if owed, nothing re-counted', async () => {
    const out = await settleVisitorMessage(null, message, offline, contact)
    expect(out).toEqual({ taken: false, notice: reply })
    expect(notice.sendOfflineNoticeIfDue).toHaveBeenCalledWith('c1', offline, contact)
    expect(db.addUnreadForAgents).not.toHaveBeenCalled()
  })

  it('taken: no offline reply, nothing counted for a colleague', async () => {
    const r = responder(true)
    const out = await settleVisitorMessage(r, message, offline, contact)
    expect(out).toEqual({ taken: true, notice: null })
    expect(r.offerVisitorMessage).toHaveBeenCalledWith({ ...message, online: false })
    expect(notice.sendOfflineNoticeIfDue).not.toHaveBeenCalled()
    expect(db.addUnreadForAgents).not.toHaveBeenCalled()
  })

  it('not taken: counted for a colleague now, and the offline reply goes', async () => {
    const out = await settleVisitorMessage(responder(false), message, offline, contact)
    expect(out).toEqual({ taken: false, notice: reply })
    expect(db.addUnreadForAgents).toHaveBeenCalledWith('c1')
    expect(notice.sendOfflineNoticeIfDue).toHaveBeenCalledWith('c1', offline, contact)
  })

  it('a junk answer counts as not taken', async () => {
    const out = await settleVisitorMessage(responder('sure'), message, offline, contact)
    expect(out.taken).toBe(false)
    expect(db.addUnreadForAgents).toHaveBeenCalledWith('c1')
  })
})

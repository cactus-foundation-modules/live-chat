import { beforeEach, describe, expect, it, vi } from 'vitest'

const points = vi.hoisted(() => ({}) as Record<string, Record<string, unknown>>)
vi.mock('@/lib/modules/extension-points.server', () => ({ moduleServerExtensionPointComponents: points }))
vi.mock('./products', () => ({ productsForTexts: vi.fn(async () => new Map()) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { clientMessages } from './serialise'
import { RESPONDER_POINT } from './responder'
import type { ChatMessage } from './db'

function message(id: number, authorUserId: string | null, sender: ChatMessage['sender'] = 'agent'): ChatMessage {
  return { id, conversationId: 'c1', sender, authorUserId, authorName: 'Name', body: 'Hello', createdAt: new Date('2026-11-24T10:00:00Z'), attachments: [] }
}

const messageLabel = vi.fn(async (): Promise<unknown> => 'Assistant')

beforeEach(() => {
  for (const key of Object.keys(points)) delete points[key]
  messageLabel.mockClear()
  points[RESPONDER_POINT] = {
    helper: {
      authorId: 'module:helper',
      offerVisitorMessage: async () => false,
      answeringAs: async () => null,
      colleagueReplied: async () => undefined,
      onlineChanged: async () => ({ covered: false }),
      messageLabel,
    },
  }
})

describe('message labels', () => {
  it('labels only the responder\'s own messages, asking once per batch', async () => {
    const out = await clientMessages([message(1, null, 'visitor'), message(2, 'module:helper'), message(3, 'user_1'), message(4, 'module:helper')], false)
    expect(out.map((m) => m.label)).toEqual([undefined, 'Assistant', undefined, 'Assistant'])
    expect(messageLabel).toHaveBeenCalledTimes(1)
  })

  it('adds nothing at all to a batch with no module author, and never asks', async () => {
    const [m] = await clientMessages([message(1, 'user_1')], true)
    expect(m).not.toHaveProperty('label')
    expect(messageLabel).not.toHaveBeenCalled()
  })

  it('adds nothing when the responder has no label, or fails', async () => {
    messageLabel.mockResolvedValueOnce(null)
    expect((await clientMessages([message(1, 'module:helper')], false))[0]).not.toHaveProperty('label')
    messageLabel.mockRejectedValueOnce(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await clientMessages([message(1, 'module:helper')], false))[0]).not.toHaveProperty('label')
  })

  it('never hands out the author id', async () => {
    const [m] = await clientMessages([message(1, 'module:helper')], true)
    expect(m).not.toHaveProperty('authorUserId')
  })
})

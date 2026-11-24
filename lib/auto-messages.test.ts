import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  createConversation: vi.fn(async () => undefined),
  deleteConversations: vi.fn(async () => 0),
  insertMessage: vi.fn(async () => ({})),
}))
const visitors = vi.hoisted(() => ({
  claimCartMessage: vi.fn(async () => true),
  claimWelcomeMessage: vi.fn(async () => true),
  clearCartAdded: vi.fn(async () => undefined),
  getAutoMessageTimes: vi.fn(async () => ({ welcomeSent: false, sinceFirstSeenMs: 60_000, sinceCartAddedMs: null })),
  getVisitorTokenHash: vi.fn(async () => 'hash'),
  markCartAdded: vi.fn(async () => undefined),
  openChatWithVisitor: vi.fn(async () => null),
  releaseCartMessage: vi.fn(async () => undefined),
  releaseWelcomeMessage: vi.fn(async () => undefined),
}))
vi.mock('./db', () => db)
vi.mock('./visitors', () => visitors)
vi.mock('./visitor', () => ({ newConversationId: () => 'new-chat' }))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { autoMessageAuthor, runAutoMessages } from './auto-messages'
import { DEFAULT_SETTINGS, type ChatSettings } from './settings'

const welcoming: ChatSettings = { ...DEFAULT_SETTINGS, welcomeEnabled: true, welcomeDelaySeconds: 0, autoMessageAuthor: 'The shop' }
const nobody = { online: false, responder: null }
const helper = { online: true, responder: { authorId: 'module:helper', authorName: 'Helper' } }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('autoMessageAuthor', () => {
  it('is the owner\'s chosen name while the switch is on and no responder is answering', () => {
    expect(autoMessageAuthor({ ...welcoming, online: true }, { online: true, responder: null })).toEqual({ name: 'The shop', userId: null })
  })

  it('is the responder whenever it is answering, switch on or off', () => {
    expect(autoMessageAuthor({ ...welcoming, online: true }, helper)).toEqual({ name: 'Helper', userId: 'module:helper' })
  })

  it('is the responder while the switch is off and it is answering', () => {
    expect(autoMessageAuthor({ ...welcoming, online: false }, helper)).toEqual({ name: 'Helper', userId: 'module:helper' })
  })

  it('is nobody while the switch is off and nothing is answering', () => {
    expect(autoMessageAuthor({ ...welcoming, online: false }, nobody)).toBeNull()
  })
})

describe('runAutoMessages', () => {
  it('sends the welcome under the owner\'s name while online, exactly as before', async () => {
    await runAutoMessages('v1', '/', { ...welcoming, online: true }, false, { online: true, responder: null })
    expect(db.insertMessage).toHaveBeenCalledWith({ conversationId: 'new-chat', sender: 'agent', authorUserId: null, authorName: 'The shop', body: welcoming.welcomeMessage })
  })

  it('sends the welcome as the responder while offline and it is answering', async () => {
    await runAutoMessages('v1', '/', { ...welcoming, online: false }, false, helper)
    expect(db.insertMessage).toHaveBeenCalledWith({ conversationId: 'new-chat', sender: 'agent', authorUserId: 'module:helper', authorName: 'Helper', body: welcoming.welcomeMessage })
  })

  it('sends nothing while offline with nobody answering', async () => {
    expect(await runAutoMessages('v1', '/', { ...welcoming, online: false }, true, nobody)).toBeUndefined()
    expect(visitors.markCartAdded).not.toHaveBeenCalled()
    expect(db.insertMessage).not.toHaveBeenCalled()
  })
})

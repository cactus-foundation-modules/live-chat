import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const points = vi.hoisted(() => ({}) as Record<string, Record<string, unknown>>)
vi.mock('@/lib/modules/extension-points.server', () => ({ moduleServerExtensionPointComponents: points }))

import {
  RESPONDER_POINT,
  RESPONDER_TIMEOUT_MS,
  answeringAs,
  getResponder,
  isResponder,
  messageLabel,
  offerVisitorMessage,
  onlineChanged,
  responderLabelFor,
  tellResponderColleagueReplied,
  visitorAnswering,
  visitorFacingOnline,
  type ResponderContract,
} from './responder'

function responder(overrides: Partial<Record<keyof ResponderContract, unknown>> = {}): ResponderContract {
  return {
    authorId: 'module:helper',
    offerVisitorMessage: vi.fn(async () => true),
    answeringAs: vi.fn(async () => ({ authorName: 'Helper' })),
    colleagueReplied: vi.fn(async () => undefined),
    onlineChanged: vi.fn(async () => ({ covered: true })),
    messageLabel: vi.fn(async () => 'Assistant'),
    ...overrides,
  } as ResponderContract
}

function install(entry: unknown) {
  points[RESPONDER_POINT] = { helper: entry }
}

const offer = { conversationId: 'c1', messageId: 7, visitorId: null, online: false, newConversation: true }

beforeEach(() => {
  for (const key of Object.keys(points)) delete points[key]
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('getResponder', () => {
  it('is null with nothing installed', async () => {
    expect(await getResponder()).toBeNull()
  })

  it('returns a well-formed responder', async () => {
    const r = responder()
    install(r)
    expect(await getResponder()).toBe(r)
  })

  it('ignores an entry that is not a responder', async () => {
    expect(isResponder(null)).toBe(false)
    expect(isResponder(() => true)).toBe(false)
    expect(isResponder(responder({ authorId: 'user_123' }))).toBe(false)
    expect(isResponder(responder({ messageLabel: 'Assistant' }))).toBe(false)
    install(responder({ authorId: 'not-a-module' }))
    expect(await getResponder()).toBeNull()
  })

  it('takes the first well-formed entry', async () => {
    const good = responder({ authorId: 'module:second' })
    points[RESPONDER_POINT] = { first: { authorId: 'module:broken' }, second: good }
    expect(await getResponder()).toBe(good)
  })
})

describe('calls to a responder fall back when it misbehaves', () => {
  it('passes a clean answer through', async () => {
    const r = responder()
    expect(await offerVisitorMessage(r, offer)).toBe(true)
    expect(r.offerVisitorMessage).toHaveBeenCalledWith(offer)
    expect(await answeringAs(r, { online: false, visitorId: 'v1' })).toEqual({ authorName: 'Helper' })
    expect(await onlineChanged(r, { online: false, openConversationIds: ['c1'] })).toEqual({ covered: true })
    expect(await messageLabel(r)).toBe('Assistant')
  })

  it('treats a throw as a no', async () => {
    const boom = async () => { throw new Error('down') }
    const r = responder({ offerVisitorMessage: boom, answeringAs: boom, onlineChanged: boom, messageLabel: boom })
    expect(await offerVisitorMessage(r, offer)).toBe(false)
    expect(await answeringAs(r, { online: false, visitorId: null })).toBeNull()
    expect(await onlineChanged(r, { online: false, openConversationIds: [] })).toEqual({ covered: false })
    expect(await messageLabel(r)).toBeNull()
  })

  it('treats a synchronous throw as a no', async () => {
    const r = responder({ offerVisitorMessage: () => { throw new Error('not even a promise') } })
    expect(await offerVisitorMessage(r, offer)).toBe(false)
  })

  it('treats junk as a no', async () => {
    const r = responder({
      offerVisitorMessage: async () => 'yes',
      answeringAs: async () => ({ authorName: '' }),
      onlineChanged: async () => ({ covered: 'very' }),
      messageLabel: async () => 42,
    })
    expect(await offerVisitorMessage(r, offer)).toBe(false)
    expect(await answeringAs(r, { online: false, visitorId: null })).toBeNull()
    expect(await onlineChanged(r, { online: false, openConversationIds: [] })).toEqual({ covered: false })
    expect(await messageLabel(r)).toBeNull()
  })

  it('treats a slow answer as a no', async () => {
    vi.useFakeTimers()
    const never = () => new Promise<boolean>(() => undefined)
    const r = responder({ offerVisitorMessage: never, answeringAs: never })
    const offered = offerVisitorMessage(r, offer)
    const answering = answeringAs(r, { online: false, visitorId: null })
    await vi.advanceTimersByTimeAsync(RESPONDER_TIMEOUT_MS)
    expect(await offered).toBe(false)
    expect(await answering).toBeNull()
  })

  it('never lets colleagueReplied throw', async () => {
    install(responder({ colleagueReplied: async () => { throw new Error('down') } }))
    await expect(tellResponderColleagueReplied({ conversationId: 'c1', userId: 'u1' })).resolves.toBeUndefined()
  })
})

describe('visitor-facing online state', () => {
  it('online state alone never asks anybody while the switch is on', async () => {
    const r = responder()
    install(r)
    expect(await visitorFacingOnline(true, 'v1')).toBe(true)
    expect(r.answeringAs).not.toHaveBeenCalled()
  })

  it('names the responder with the switch on when it is answering (AI-first style)', async () => {
    const r = responder()
    install(r)
    expect(await visitorAnswering(true, 'v1')).toEqual({ online: true, responder: { authorId: 'module:helper', authorName: 'Helper' } })
    expect(r.answeringAs).toHaveBeenCalledWith({ online: true, visitorId: 'v1' })
  })

  it('stays online with the switch on when the responder is not answering', async () => {
    install(responder({ answeringAs: async () => null }))
    expect(await visitorAnswering(true, 'v1')).toEqual({ online: true, responder: null })
  })

  it('is the switch, exactly, with no responder', async () => {
    expect(await visitorFacingOnline(false, 'v1')).toBe(false)
    expect(await visitorFacingOnline(true, null)).toBe(true)
  })

  it('is online while the switch is off when a responder is answering', async () => {
    const r = responder()
    install(r)
    expect(await visitorAnswering(false, 'v1')).toEqual({ online: true, responder: { authorId: 'module:helper', authorName: 'Helper' } })
    expect(r.answeringAs).toHaveBeenCalledWith({ online: false, visitorId: 'v1' })
  })

  it('is offline when the responder is not answering, or fails', async () => {
    install(responder({ answeringAs: async () => null }))
    expect(await visitorFacingOnline(false, null)).toBe(false)
    install(responder({ answeringAs: async () => { throw new Error('down') } }))
    expect(await visitorFacingOnline(false, null)).toBe(false)
  })
})

describe('responderLabelFor', () => {
  it('never reads the registry when no message is a module\'s', async () => {
    const r = responder()
    install(r)
    expect(await responderLabelFor([{ authorUserId: 'user_1' }, { authorUserId: null }])).toBeNull()
    expect(r.messageLabel).not.toHaveBeenCalled()
  })

  it('labels the registered responder\'s messages, asking once', async () => {
    const r = responder()
    install(r)
    expect(await responderLabelFor([{ authorUserId: 'module:helper' }, { authorUserId: 'module:helper' }])).toEqual({ authorId: 'module:helper', label: 'Assistant' })
    expect(r.messageLabel).toHaveBeenCalledTimes(1)
  })

  it('gives nothing for another module\'s author id, or when there is no responder', async () => {
    expect(await responderLabelFor([{ authorUserId: 'module:helper' }])).toBeNull()
    install(responder())
    expect(await responderLabelFor([{ authorUserId: 'module:someone-else' }])).toBeNull()
  })
})

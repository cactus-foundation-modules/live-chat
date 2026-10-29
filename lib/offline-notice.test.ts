import { describe, it, expect } from 'vitest'
import { offlineNoticeText } from './offline-notice'

describe('offlineNoticeText', () => {
  const opening = 'Sorry - we have had to step away.'

  it('asks for a way to reply when we have none', () => {
    expect(offlineNoticeText(opening, { email: null, phone: null })).toBe(
      `${opening} If you leave your email address or phone number in the box at the top of this chat, we will get back to you as soon as we are back.`,
    )
  })

  it('says where we will reply when we can, email first', () => {
    expect(offlineNoticeText(opening, { email: 'sam@example.com', phone: '07700900000' })).toContain('at sam@example.com')
    expect(offlineNoticeText(opening, { email: null, phone: '07700900000' })).toContain('on 07700900000')
  })
})

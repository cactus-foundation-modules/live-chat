import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetKeyringState, setKeyringState } from '@/lib/crypto/keyring'
import { attachmentSignature, attachmentSignatureValid, hashIp } from '@/modules/chat/lib/visitor'

// Attachment links survive a change of encryption key (core's lib/crypto/keyring
// .ts), and hashed visitor addresses do not change with it.

const OLD = '1a'.repeat(32)
const NEW = '2b'.repeat(32)
const saved = process.env.ENCRYPTION_KEY

beforeEach(() => {
  resetKeyringState()
  process.env.ENCRYPTION_KEY = OLD
})
afterEach(() => {
  resetKeyringState()
  if (saved === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = saved
})

describe('chat attachment links after a key rotation', () => {
  it('accepts one signed with the previous key', () => {
    const before = attachmentSignature('att1')
    process.env.ENCRYPTION_KEY = NEW
    setKeyringState({ previous: [OLD] })
    expect(attachmentSignatureValid('att1', before)).toBe(true)
    expect(attachmentSignatureValid('att2', before)).toBe(false)
  })

  it('signs new ones with the current key only', () => {
    process.env.ENCRYPTION_KEY = NEW
    setKeyringState({ previous: [OLD] })
    const after = attachmentSignature('att1')
    process.env.ENCRYPTION_KEY = OLD
    resetKeyringState()
    expect(attachmentSignatureValid('att1', after)).toBe(false)
  })

  it('still works on a site with no key, as before', () => {
    delete process.env.ENCRYPTION_KEY
    expect(attachmentSignatureValid('att1', attachmentSignature('att1'))).toBe(true)
  })
})

describe('hashed visitor addresses', () => {
  it('are exactly what they were before the salt existed', () => {
    expect(hashIp('203.0.113.9')).toBe(createHash('sha256').update(`${OLD}:chat-ip:203.0.113.9`).digest('hex').slice(0, 32))
  })

  it('do not change when the key does', () => {
    const before = hashIp('203.0.113.9')
    process.env.ENCRYPTION_KEY = NEW
    setKeyringState({ previous: [OLD], derivationSalt: OLD })
    expect(hashIp('203.0.113.9')).toBe(before)
  })
})

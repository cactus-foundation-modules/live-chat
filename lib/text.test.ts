import { describe, expect, it } from 'vitest'
import { cleanEmail, cleanName, cleanPhone, fileProblem, filesProblem, previewOf } from './text'
import { CHAT_WORKER_SOURCE } from './worker'

describe('previewOf', () => {
  it('flattens whitespace and trims long text', () => {
    expect(previewOf('  hello\n\nthere  ')).toBe('hello there')
    expect(previewOf('x'.repeat(200))?.length).toBe(140)
    expect(previewOf('   ')).toBeNull()
  })
})

describe('cleanPhone', () => {
  it('strips spaces and punctuation', () => {
    expect(cleanPhone('07332 342 234')).toBe('07332342234')
    expect(cleanPhone('(07332) 342-234')).toBe('07332342234')
  })
  it('turns a UK international number into its 0 form', () => {
    expect(cleanPhone('+447332 342 234')).toBe('07332342234')
    expect(cleanPhone('+44 (0)7332 342234')).toBe('07332342234')
    expect(cleanPhone('00447332342234')).toBe('07332342234')
    expect(cleanPhone('447332342234')).toBe('07332342234')
  })
  it('keeps another country\'s code', () => {
    expect(cleanPhone('+1 415 555 2671')).toBe('+14155552671')
  })
  it('refuses what is not a number', () => {
    expect(cleanPhone('call me')).toBeNull()
    expect(cleanPhone('0733')).toBeNull()
    expect(cleanPhone(42)).toBeNull()
  })
})

describe('cleanEmail / cleanName', () => {
  it('accepts a real address and lower-cases it', () => {
    expect(cleanEmail(' Someone@Example.co.uk ')).toBe('someone@example.co.uk')
  })
  it('refuses nonsense', () => {
    expect(cleanEmail('not an email')).toBeNull()
    expect(cleanEmail(42)).toBeNull()
  })
  it('tidies a name and drops an empty one', () => {
    expect(cleanName('  Jo   Bloggs ')).toBe('Jo Bloggs')
    expect(cleanName('   ')).toBeNull()
  })
})

describe('file rules', () => {
  it('refuses executables and markup by their last extension', () => {
    expect(fileProblem({ name: 'invoice.pdf.exe', size: 10 })).toMatch(/cannot accept/)
    expect(fileProblem({ name: 'page.html', size: 10 })).toMatch(/cannot accept/)
    expect(fileProblem({ name: 'photo.jpg', size: 10 })).toBeNull()
  })
  it('refuses empty and oversized files', () => {
    expect(fileProblem({ name: 'a.pdf', size: 0 })).toMatch(/empty/)
    expect(fileProblem({ name: 'a.pdf', size: 50 * 1024 * 1024 })).toMatch(/limit/)
  })
  it('limits how many go at once', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png`, size: 1 }))
    expect(filesProblem(many)).toMatch(/Up to/)
  })
})

describe('service worker source', () => {
  it('parses as JavaScript', () => {
    expect(() => new Function(CHAT_WORKER_SOURCE)).not.toThrow()
  })
})

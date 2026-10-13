import { describe, expect, it } from 'vitest'
import { cartTotal, cleanCartInput, cleanPath, cleanReferrer, deviceFrom, extendTrail } from './trail'
import { MAX_TRAIL } from './constants'

describe('cleanPath', () => {
  it('keeps a same-site path with its query', () => {
    expect(cleanPath('/chairs/task-chair?colour=blue')).toBe('/chairs/task-chair?colour=blue')
  })
  it('refuses anything that is not a same-site path', () => {
    expect(cleanPath('https://elsewhere.example/')).toBeNull()
    expect(cleanPath('//elsewhere.example/')).toBeNull()
    expect(cleanPath('/a b')).toBeNull()
    expect(cleanPath('/<script>')).toBeNull()
    expect(cleanPath(42)).toBeNull()
  })
  it('caps a long path', () => {
    expect(cleanPath(`/${'a'.repeat(900)}`)?.length).toBe(500)
  })
})

describe('cleanReferrer', () => {
  it('keeps only the host of somewhere else', () => {
    expect(cleanReferrer('https://www.google.com/search?q=desk', 'shop.example')).toBe('google.com')
  })
  it('drops the site itself and anything odd', () => {
    expect(cleanReferrer('https://www.shop.example/chairs', 'shop.example')).toBeNull()
    expect(cleanReferrer('javascript:alert(1)', null)).toBeNull()
    expect(cleanReferrer('not a url', null)).toBeNull()
    expect(cleanReferrer('', null)).toBeNull()
  })
})

describe('deviceFrom', () => {
  it('tells a phone, a tablet and a computer apart', () => {
    expect(deviceFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('Phone')
    expect(deviceFrom('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe('Phone')
    expect(deviceFrom('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('Tablet')
    expect(deviceFrom('Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36')).toBe('Tablet')
    expect(deviceFrom('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0')).toBe('Computer')
    expect(deviceFrom(null)).toBeNull()
  })
})

describe('extendTrail', () => {
  const at = '2026-10-13T10:00:00.000Z'
  it('adds a new page and says the visitor moved', () => {
    const { trail, moved } = extendTrail([{ path: '/', title: 'Home', at }], { path: '/chairs', title: 'Chairs', at })
    expect(moved).toBe(true)
    expect(trail.map((p) => p.path)).toEqual(['/', '/chairs'])
  })
  it('does not repeat the page they are already on', () => {
    const { trail, moved } = extendTrail([{ path: '/chairs', title: null, at }], { path: '/chairs', title: 'Chairs', at: '2026-10-13T10:05:00.000Z' })
    expect(moved).toBe(false)
    expect(trail).toEqual([{ path: '/chairs', title: 'Chairs', at }])
  })
  it('keeps only the newest pages', () => {
    let trail: unknown = []
    for (let i = 0; i < MAX_TRAIL + 5; i++) trail = extendTrail(trail, { path: `/p${i}`, title: null, at }).trail
    const pages = trail as Array<{ path: string }>
    expect(pages).toHaveLength(MAX_TRAIL)
    expect(pages[pages.length - 1]?.path).toBe(`/p${MAX_TRAIL + 4}`)
  })
  it('survives a stored trail that is not a trail', () => {
    expect(extendTrail('nonsense', { path: '/', title: null, at }).trail).toHaveLength(1)
  })
})

describe('cleanCartInput', () => {
  it('leaves an unreported basket alone and empties a non-list', () => {
    expect(cleanCartInput(undefined)).toBeUndefined()
    expect(cleanCartInput('lots')).toEqual([])
  })
  it('adds up lines for the same product and drops nonsense', () => {
    expect(cleanCartInput([
      { productId: 'abc-1', quantity: 2 },
      { productId: 'abc-1', quantity: '1', lineId: 'engraved' },
      { productId: "x'; drop table", quantity: 1 },
      { productId: 'def', quantity: 0 },
      { productId: 'ghi', quantity: 2.7 },
      null,
    ])).toEqual([{ productId: 'abc-1', quantity: 3 }, { productId: 'ghi', quantity: 2 }])
  })
})

describe('cartTotal', () => {
  it('adds up in pence so the answer is not a float', () => {
    expect(cartTotal([
      { productId: 'a', name: 'A', quantity: 3, unitPrice: '0.10' },
      { productId: 'b', name: 'B', quantity: 1, unitPrice: '149.99' },
    ])).toBe('150.29')
  })
  it('gives no total when a price is missing', () => {
    expect(cartTotal([{ productId: 'a', name: null, quantity: 1, unitPrice: null }])).toBeNull()
  })
})

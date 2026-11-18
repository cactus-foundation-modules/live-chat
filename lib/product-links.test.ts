import { describe, it, expect } from 'vitest'
import { messageHtml, productAddressesIn, splitMessage, type ChatProduct } from './product-links'
import { slugFromAddress } from './products'

const OSLO: ChatProduct = {
  url: 'https://example.com/oslo-chair',
  name: 'Oslo Chair',
  options: null,
  price: '£99.00',
  imageUrl: 'https://example.com/media/oslo.webp',
}

describe('product addresses in a chat message', () => {
  it('finds bare addresses and inbox links, without trailing punctuation', () => {
    expect(productAddressesIn('Is https://example.com/oslo-chair. any good? [Desk](https://example.com/desk) - £1')).toEqual([
      'https://example.com/oslo-chair',
      'https://example.com/desk',
    ])
  })

  it('draws a pasted address as the product, and eats the line breaks round it', () => {
    const text = 'Have a look:\nhttps://example.com/oslo-chair\nIt is lovely.'
    expect(splitMessage(text, { 'https://example.com/oslo-chair': OSLO })).toEqual([
      'Have a look:',
      { product: OSLO },
      'It is lovely.',
    ])
  })

  it('draws the inbox line as the product, price and all', () => {
    const text = 'Try this:\n[Oslo Chair](https://example.com/oslo-chair) - £99.00'
    expect(splitMessage(text, { 'https://example.com/oslo-chair': OSLO })).toEqual(['Try this:', { product: OSLO }])
  })

  it('keeps whatever somebody wrote after the dash when it is not the price', () => {
    const text = '[Oslo Chair](https://example.com/oslo-chair) - my favourite'
    expect(splitMessage(text, { 'https://example.com/oslo-chair': OSLO })).toEqual([{ product: OSLO }, ' - my favourite'])
  })

  it('leaves an address that is not a product exactly as it was', () => {
    const text = 'See https://example.com/about and [x](https://x.test/a)'
    expect(splitMessage(text, {})).toEqual(['See https://example.com/about and ', { label: 'x', url: 'https://x.test/a' }])
  })

  it('escapes the words and builds the card from the shop data only', () => {
    const html = messageHtml('<b>https://example.com/oslo-chair', { 'https://example.com/oslo-chair': { ...OSLO, name: 'A&B' } })
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('A&amp;B')
    expect(html).toContain('£99.00')
    expect(messageHtml('no products here', {})).toBeNull()
  })
})

describe('slugFromAddress', () => {
  it('reads our own product pages only', () => {
    expect(slugFromAddress('https://www.example.com/shop/products/oslo-chair?x=1', 'https://example.com', false)).toBe('oslo-chair')
    expect(slugFromAddress('https://example.com/oslo-chair', 'https://example.com', true)).toBe('oslo-chair')
    expect(slugFromAddress('https://example.com/oslo-chair', 'https://example.com', false)).toBeNull()
    expect(slugFromAddress('https://elsewhere.com/oslo-chair', 'https://example.com', true)).toBeNull()
    expect(slugFromAddress('https://example.com/a/b', 'https://example.com', true)).toBeNull()
  })
})

describe('a delivery quoted beside a product', () => {
  const address = 'https://example.com/oslo-chair?delivery-service=express'
  const withDelivery: ChatProduct = { ...OSLO, url: 'https://example.com/oslo-chair', delivery: { label: 'Express', price: '£25.00 + VAT' } }

  it('swallows the inbox delivery line under the card that already shows it', () => {
    const text = `Try this:\n[Oslo Chair](${address}) - £99.00\nDelivery: Express - £25.00 + VAT\nAny questions, shout.`
    expect(splitMessage(text, { [address]: withDelivery })).toEqual([
      'Try this:',
      { product: withDelivery },
      'Any questions, shout.',
    ])
  })

  it('keeps a delivery line that no longer matches, under the price it does eat', () => {
    const text = `[Oslo Chair](${address}) - £99.00\nDelivery: Express - £20.00`
    expect(splitMessage(text, { [address]: withDelivery })).toEqual([
      { product: withDelivery },
      'Delivery: Express - £20.00',
    ])
  })

  it('draws the delivery as its own row in the inbox', () => {
    const html = messageHtml(`[Oslo Chair](${address}) - £99.00`, { [address]: withDelivery }) ?? ''
    expect(html).toContain('Delivery: Express')
    expect(html).toContain('£25.00 + VAT')
  })
})


import { describe, it, expect } from 'vitest'
import { linksToHtml, splitLinks, withoutLinks } from './links'

describe('chat message links', () => {
  const text = 'Try this:\n[Oslo Chair](https://deskwell.co.uk/oslo) - £99.00'

  it('cuts a message into words and links', () => {
    expect(splitLinks(text)).toEqual([
      'Try this:\n',
      { label: 'Oslo Chair', url: 'https://deskwell.co.uk/oslo' },
      ' - £99.00',
    ])
  })

  it('leaves non-web addresses as plain words', () => {
    expect(splitLinks('[x](javascript:alert(1))')).toEqual(['[x](javascript:alert(1))'])
  })

  it('keeps only the words for a preview', () => {
    expect(withoutLinks(text)).toBe('Try this:\nOslo Chair - £99.00')
  })

  it('escapes everything but the anchors it makes', () => {
    expect(linksToHtml('<b>[A&B](https://x.test/a)</b>')).toBe(
      '&lt;b&gt;<a href="https://x.test/a" target="_blank" rel="noopener noreferrer">A&amp;B</a>&lt;/b&gt;',
    )
    expect(linksToHtml('no links here')).toBeNull()
  })
})

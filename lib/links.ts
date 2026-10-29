// `[words](https://address)` in a message, which is how a reply written in the
// Unified Inbox carries a product: the name as the link, the price beside it.
// Only web addresses become links, and the result is never markup - segments
// for the browser to draw, or escaped HTML for the inbox - so nothing a
// visitor or a colleague types can smuggle a tag in.

const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s()]{1,2000})\)/g

export type LinkSegment = string | { label: string; url: string }

/** The text cut into plain stretches and links, in order. */
export function splitLinks(text: string): LinkSegment[] {
  const out: LinkSegment[] = []
  let from = 0
  for (const match of text.matchAll(LINK)) {
    const at = match.index ?? 0
    if (at > from) out.push(text.slice(from, at))
    out.push({ label: match[1] as string, url: match[2] as string })
    from = at + match[0].length
  }
  if (from < text.length) out.push(text.slice(from))
  return out
}

/** The words alone, for a list preview or a notification. */
export function withoutLinks(text: string): string {
  return text.replace(LINK, '$1')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Escaped HTML with the links as anchors, or null when there are none. */
export function linksToHtml(text: string): string | null {
  const parts = splitLinks(text)
  if (!parts.some((part) => typeof part !== 'string')) return null
  return parts
    .map((part) => (
      typeof part === 'string'
        ? escapeHtml(part).replace(/\n/g, '<br>')
        : `<a href="${escapeHtml(part.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(part.label)}</a>`
    ))
    .join('')
}

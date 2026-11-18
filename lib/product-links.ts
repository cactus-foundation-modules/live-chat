import { escapeHtml, splitLinks } from './links'

// Which parts of a message are product pages, and what the message looks like
// once they are drawn as products.
//
// Pure, and shared by the server (which looks the addresses up - lib/products.ts)
// and the browser (which draws what came back). The lookup answers with a map
// keyed by the address exactly as it was written, so the two halves cannot
// disagree about which address was meant.
//
// Two shapes count: an address on its own, as somebody pastes it, and the
// `[name](address) - price` line the Unified Inbox sends a picked product as.
// An address that turns out not to be a product stays exactly what it was.

/** One product, as a chat draws it. */
export type ChatProduct = {
  /** Its own page, built by us rather than echoed from the message. */
  url: string
  name: string
  /** 'Black / High back' on a variation, null otherwise. */
  options: string | null
  /** 'From £419.00 + VAT', '£249.00', or null with nothing worth quoting. */
  price: string | null
  imageUrl: string | null
  /** The delivery service quoted beside it, where the address names one (the
   *  Unified Inbox puts `delivery-service=<key>` on a product it sends with a
   *  delivery chosen) and the shop still offers it for this product. Priced
   *  today, like the product: '£25.00 + VAT', or 'Free'. */
  delivery?: { label: string; price: string } | null
}

/** The line the Unified Inbox prints a chosen delivery as, under the product:
 *  'Delivery: Express flat-pack - £25.00 + VAT'. Restated rather than imported
 *  - chat does not need the inbox - and only ever used to recognise it. */
export function deliveryLine(delivery: { label: string; price: string }): string {
  return `Delivery: ${delivery.label} - ${delivery.price}`
}

export type MessagePart = string | { label: string; url: string } | { product: ChatProduct }

// Stops at whitespace and at the characters that never end an address in
// running text; trailing punctuation is handed back to the sentence below.
const BARE = /https?:\/\/[^\s<>()[\]{}"']+/g
const TRAILING = /[.,!?;:]+$/

function bareAddresses(text: string): { at: number; url: string }[] {
  const out: { at: number; url: string }[] = []
  for (const match of text.matchAll(BARE)) {
    const url = match[0].replace(TRAILING, '')
    if (url.length > 2000) continue
    out.push({ at: match.index ?? 0, url })
  }
  return out
}

/** Every address in a message that could be a product page, in order. */
export function productAddressesIn(text: string): string[] {
  const out: string[] = []
  for (const part of splitLinks(text)) {
    if (typeof part === 'string') out.push(...bareAddresses(part).map((a) => a.url))
    else out.push(part.url)
  }
  return out
}

/** What the Unified Inbox writes after a product's link, longest first, so the
 *  card can take its place: ` - £249.00`, and the delivery line under it where
 *  one was chosen. */
function inboxTails(product: ChatProduct): string[] {
  const price = product.price ? ` - ${product.price}` : ''
  const delivery = product.delivery ? `\n${deliveryLine(product.delivery)}` : ''
  return delivery ? [price + delivery, price] : [price]
}

/**
 * The message cut into words, links and products, in order.
 *
 * A product swallows the line break either side of it, because it is drawn as
 * a block of its own and a block between two blank lines is a gap nobody typed.
 * It also swallows the " - £249.00" the inbox prints after a product's name,
 * and the "Delivery: ..." line under it, but only when that is what it is about
 * to show anyway: anything else after the dash is something somebody wrote.
 */
export function splitMessage(text: string, products: Readonly<Record<string, ChatProduct>>): MessagePart[] {
  const out: MessagePart[] = []
  let eatLeading: string[] | null = null

  const pushText = (value: string) => {
    let words = value
    if (eatLeading !== null) {
      // The longest tail that is really there: the price and the delivery line,
      // else the price alone - a delivery whose price has moved since the
      // message went is something the card already says better.
      const tail = eatLeading.find((t) => t && words.startsWith(t))
      if (tail) words = words.slice(tail.length)
      words = words.replace(/^\n/, '')
      eatLeading = null
    }
    if (!words) return
    const last = out[out.length - 1]
    if (typeof last === 'string') out[out.length - 1] = last + words
    else out.push(words)
  }
  const pushProduct = (product: ChatProduct, tail: string[]) => {
    const last = out[out.length - 1]
    if (typeof last === 'string') {
      const trimmed = last.replace(/\n$/, '')
      if (trimmed) out[out.length - 1] = trimmed
      else out.pop()
    }
    out.push({ product })
    eatLeading = tail
  }

  for (const part of splitLinks(text)) {
    if (typeof part !== 'string') {
      const product = products[part.url]
      if (product) pushProduct(product, inboxTails(product))
      else {
        eatLeading = null
        out.push(part)
      }
      continue
    }
    let from = 0
    for (const { at, url } of bareAddresses(part)) {
      const product = products[url]
      if (!product) continue
      pushText(part.slice(from, at))
      pushProduct(product, [])
      from = at + url.length
    }
    pushText(part.slice(from))
  }
  return out
}

/**
 * The message as escaped HTML for an inbox: words, links as anchors and each
 * product as a small table - picture, name, price - in the same plain shape the
 * Unified Inbox prints a product into an email. Email rules throughout, because
 * that is how the inbox shows it: tables, inline styles, fixed pixels, and the
 * email's own greys rather than the site's tokens, which do not exist there.
 * Null when there is nothing but words, so the inbox shows the words.
 */
export function messageHtml(text: string, products: Readonly<Record<string, ChatProduct>>): string | null {
  const parts = splitMessage(text, products)
  if (!parts.some((part) => typeof part !== 'string')) return null
  return parts
    .map((part) => {
      if (typeof part === 'string') return escapeHtml(part).replace(/\n/g, '<br>')
      if ('label' in part) {
        return `<a href="${escapeHtml(part.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(part.label)}</a>`
      }
      return productHtml(part.product)
    })
    .join('')
}

function productHtml(product: ChatProduct): string {
  const href = escapeHtml(product.url)
  const cell = 'padding:8px 0;vertical-align:top;font-size:15px;line-height:1.45;color:#333333;'
  const thumb = product.imageUrl
    ? `<td width="64" style="${cell}width:64px;padding-right:12px;"><a href="${href}" target="_blank" rel="noopener noreferrer">` +
      `<img src="${escapeHtml(product.imageUrl)}" width="64" height="64" alt="" ` +
      'style="display:block;width:64px;height:64px;border:1px solid #e5e5e5;border-radius:4px;object-fit:cover;" /></a></td>'
    : ''
  const options = product.options
    ? `<br /><span style="color:#666666;font-size:13px;">${escapeHtml(product.options)}</span>`
    : ''
  const delivery = product.delivery
    ? '<tr>' +
      (product.imageUrl ? '<td width="64" style="width:64px;padding:0 12px 0 0;">&nbsp;</td>' : '') +
      `<td style="padding:0 0 8px;font-size:14px;line-height:1.45;color:#666666;">Delivery: ${escapeHtml(product.delivery.label)}</td>` +
      `<td align="right" style="padding:0 0 8px 12px;font-size:14px;line-height:1.45;color:#666666;white-space:nowrap;">${escapeHtml(product.delivery.price)}</td>` +
      '</tr>'
    : ''
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
    'style="border-collapse:collapse;width:100%;margin:8px 0;"><tr>' +
    thumb +
    `<td style="${cell}"><strong><a href="${href}" target="_blank" rel="noopener noreferrer" ` +
    `style="color:#333333;text-decoration:underline;">${escapeHtml(product.name)}</a></strong>${options}</td>` +
    `<td align="right" style="${cell}padding-left:12px;white-space:nowrap;">${escapeHtml(product.price ?? '')}</td>` +
    '</tr>' + delivery + '</table>'
  )
}

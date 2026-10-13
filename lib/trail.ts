import { MAX_TRAIL } from './constants'

// Pure helpers for a visitor's trail and basket, shared by the presence route
// and its tests. Nothing in here touches the database or the request.

export type TrailPage = { path: string; title: string | null; at: string }

export type CartLineIn = { productId: string; quantity: number }

export type CartLine = { productId: string; name: string | null; quantity: number; unitPrice: string | null }

/** A same-site path, or null. Never a full address, so a visitor's trail cannot
 *  be used to carry anything off-site, and capped so it cannot be used to fill
 *  the table either. The query string is kept: on a shop it is often what says
 *  which colour of a chair somebody is looking at. */
export function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (/[\s<>]/.test(path)) return null
  return path.slice(0, 500)
}

export function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.replace(/\s+/g, ' ').trim().slice(0, 200)
  return title || null
}

/** The site the visitor arrived from, as a bare host, or null for a visit that
 *  started on this site (or arrived with no referrer at all). */
export function cleanReferrer(value: unknown, ownHost: string | null): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (ownHost && host === ownHost.toLowerCase().replace(/^www\./, '')) return null
    return host.slice(0, 200) || null
  } catch {
    return null
  }
}

/** Phone, Tablet or Computer, from the browser's own description of itself. */
export function deviceFrom(userAgent: string | null): string | null {
  if (!userAgent) return null
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(userAgent)) return 'Tablet'
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) return 'Phone'
  return 'Computer'
}

/** The trail with one more page on the end. A page that is the same as the last
 *  one (a reload, or a basket change that checked in from where they already
 *  were) moves nothing but its title. */
export function extendTrail(trail: unknown, page: TrailPage): { trail: TrailPage[]; moved: boolean } {
  const pages = readTrail(trail)
  const last = pages[pages.length - 1]
  if (last && last.path === page.path) {
    if (page.title && page.title !== last.title) pages[pages.length - 1] = { ...last, title: page.title }
    return { trail: pages, moved: false }
  }
  pages.push(page)
  return { trail: pages.slice(-MAX_TRAIL), moved: true }
}

export function readTrail(value: unknown): TrailPage[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({
      path: typeof p.path === 'string' ? p.path : '/',
      title: typeof p.title === 'string' ? p.title : null,
      at: typeof p.at === 'string' ? p.at : new Date(0).toISOString(),
    }))
}

/** The basket as the browser reported it, tidied: real-looking ids only, whole
 *  quantities, the same product's lines added together, and no more than a
 *  basket could sensibly hold. undefined means "not reported" (leave it be);
 *  an empty array means the basket is empty. */
export function cleanCartInput(value: unknown): CartLineIn[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  const totals = new Map<string, number>()
  for (const line of value.slice(0, 100)) {
    if (!line || typeof line !== 'object') continue
    const { productId, quantity } = line as { productId?: unknown; quantity?: unknown }
    if (typeof productId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(productId)) continue
    const qty = Math.floor(Number(quantity))
    if (!Number.isFinite(qty) || qty <= 0) continue
    totals.set(productId, Math.min(9999, (totals.get(productId) ?? 0) + qty))
  }
  return Array.from(totals, ([productId, quantity]) => ({ productId, quantity })).slice(0, 30)
}

export function readCart(value: unknown): CartLine[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => ({
      productId: String(l.productId ?? ''),
      name: typeof l.name === 'string' ? l.name : null,
      quantity: Number(l.quantity ?? 0) || 0,
      unitPrice: typeof l.unitPrice === 'string' ? l.unitPrice : null,
    }))
}

/** The basket's value at the prices it was looked up at, or null when any line
 *  has no price we could find (a total that quietly left one out would be
 *  worse than none). */
export function cartTotal(lines: CartLine[]): string | null {
  let pence = 0
  for (const line of lines) {
    if (line.unitPrice === null) return null
    const unit = Math.round(Number(line.unitPrice) * 100)
    if (!Number.isFinite(unit)) return null
    pence += unit * line.quantity
  }
  return (pence / 100).toFixed(2)
}

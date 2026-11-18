import { prisma } from '@/lib/db/prisma'
import { getSiteUrlOrNull } from '@/lib/config/env'
import type { ChatProduct } from './product-links'
import { productAddressesIn } from './product-links'

// The site's own products, behind the addresses people put in a chat.
//
// Somebody on either side pastes a product page into the chat - or the Unified
// Inbox sends one as `[name](address) - price` - and both sides see the product
// itself: its picture, its name and what it costs, the way the inbox shows one
// in a reply. Looked up when a message is handed to a browser rather than
// stored with it, so nothing about a message's shape changes and a price is
// always today's.
//
// RAW SQL ONLY, no import of the shop's code: chat does not need a shop, and a
// site without one finds that out with one cheap catalogue check and gets the
// addresses as words, as it always did. The price rules are the shop's own,
// restated small - the sale price where the shop has sales switched on, the
// cheapest switched-on variation for a listing that has them, the tax added or
// taken off to match what the storefront prints, and "+ VAT" only where the
// shop quotes net and the thing is actually taxed.

const SHOP_TABLES = ['shp_products', 'shp_product_media', 'shp_settings']
const VARIATION_TABLES = ['svr_variants', 'svr_variant_values', 'svr_options', 'svr_option_values']

/** How long one answer is trusted. A chat open in the admin asks again every
 *  few seconds; a price change can wait a minute to show. */
const TTL_MS = 60_000
const CACHE_MAX = 500
const cache = new Map<string, { at: number; product: ChatProduct | null }>()

type Settings = {
  siteUrl: string
  rootStyle: boolean
  currencySymbol: string
  saleEnabled: boolean
  /** Whether the stored figures carry tax, and whether the storefront prints
   *  them with it. */
  storedIncludesTax: boolean
  showsTax: boolean
  taxLabel: string
  rates: Map<string, number>
  variations: boolean
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/** The slug a product page's address names, or null when it is not one of ours.
 *  `/shop/products/<slug>` always; a bare `/<slug>` only on a shop that
 *  publishes its products there. The query is read separately (picksFromAddress). */
export function slugFromAddress(address: string, siteUrl: string | null, rootStyle: boolean): string | null {
  if (!siteUrl) return null
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (bareHost(url.hostname) !== bareHost(new URL(siteUrl).hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s))
    const slug = parts.length === 3 && parts[0] === 'shop' && parts[1] === 'products'
      ? parts[2]
      : rootStyle && parts.length === 1 ? parts[0] : null
    const clean = slug?.trim() ?? ''
    return clean && clean.length <= 300 ? clean : null
  } catch {
    return null
  }
}

async function tablesPresent(names: string[]): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT n AS name FROM unnest(${names}::text[]) AS n
     WHERE to_regclass('public.' || quote_ident(n)) IS NOT NULL
  `
  return new Set(rows.map((r) => r.name))
}

/** Everything about money and addresses that is the same for every product, or
 *  null where there is no shop to ask. */
async function readSettings(): Promise<Settings | null> {
  const siteUrl = getSiteUrlOrNull()
  if (!siteUrl) return null
  const present = await tablesPresent([...SHOP_TABLES, ...VARIATION_TABLES])
  if (!SHOP_TABLES.every((t) => present.has(t))) return null

  const rows = await prisma.$queryRaw<{ config: unknown }[]>`
    SELECT "config" FROM "shp_settings" WHERE "id" = 'singleton' LIMIT 1
  `.catch(() => [] as { config: unknown }[])
  const config = (rows[0]?.config ?? {}) as Record<string, unknown>
  const storedIncludesTax = config.taxMode !== 'EXCLUSIVE'
  const mode = config.priceDisplayTax

  const settings: Settings = {
    siteUrl: siteUrl.replace(/\/$/, ''),
    rootStyle: config.productUrlStyle === 'ROOT',
    currencySymbol: typeof config.currencySymbol === 'string' && config.currencySymbol ? config.currencySymbol : '£',
    saleEnabled: Array.isArray(config.enabledPriceTypes) && config.enabledPriceTypes.includes('sale'),
    storedIncludesTax,
    showsTax: mode === 'INCLUSIVE' ? true : mode === 'EXCLUSIVE' ? false : storedIncludesTax,
    taxLabel: typeof config.invoiceTaxLabel === 'string' && config.invoiceTaxLabel.trim() ? config.invoiceTaxLabel.trim() : 'VAT',
    rates: new Map(),
    variations: VARIATION_TABLES.every((t) => present.has(t)),
  }

  // The shop's default zone - the catch-all with no postcodes, or the first by
  // name - which is how the shop picks one before anybody has an address.
  const zones = await prisma.$queryRaw<{ id: string; postcodes: unknown }[]>`
    SELECT "id", "postcodes" FROM "shp_shipping_zones" ORDER BY "name" ASC
  `.catch(() => [] as { id: string; postcodes: unknown }[])
  const zone = zones.find((z) => Array.isArray(z.postcodes) && z.postcodes.length === 0) ?? zones[0]
  if (zone) {
    const rates = await prisma.$queryRaw<{ tax_class_id: string; rate: unknown }[]>`
      SELECT "tax_class_id", "rate" FROM "shp_tax_zone_rates" WHERE "zone_id" = ${zone.id}
    `.catch(() => [] as { tax_class_id: string; rate: unknown }[])
    for (const row of rates) {
      const rate = toNumber(row.rate)
      if (rate !== null) settings.rates.set(row.tax_class_id, rate)
    }
  }
  return settings
}

function charged(price: unknown, sale: unknown, saleEnabled: boolean): number {
  const full = toNumber(price) ?? 0
  const offer = toNumber(sale)
  if (!saleEnabled || offer === null || offer < 0 || offer >= full) return full
  return offer
}

/** 'From £419.00 + VAT', '£249.00', or null where there is nothing worth
 *  quoting - a price of nothing is a shop saying "not from here". */
function priceLine(amount: number, from: boolean, taxClassId: unknown, s: Settings): string | null {
  if (!(amount > 0)) return null
  const rate = typeof taxClassId === 'string' ? s.rates.get(taxClassId) ?? 0 : 0
  let shown = amount
  if (rate > 0 && s.showsTax !== s.storedIncludesTax) {
    shown = Math.round((s.showsTax ? amount * (1 + rate) : amount / (1 + rate)) * 100) / 100
  }
  const figure = `${s.currencySymbol}${shown.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const suffix = rate > 0 && !s.showsTax ? ` + ${s.taxLabel}` : ''
  return `${from ? 'From ' : ''}${figure}${suffix}`
}

function absoluteImage(url: unknown, siteUrl: string): string | null {
  const value = typeof url === 'string' ? url.trim() : ''
  if (/^https?:\/\//i.test(value)) return value
  return value.startsWith('/') ? `${siteUrl}${value}` : null
}

function pageOf(slug: string, s: Settings): string {
  return s.rootStyle
    ? `${s.siteUrl}/${encodeURIComponent(slug)}`
    : `${s.siteUrl}/shop/products/${encodeURIComponent(slug)}`
}

/** The name an option's query parameter goes by on the storefront - the
 *  option's name, lowercased, accents folded, runs of anything else hyphenated.
 *  Restated from the variations module, which this one does not import. */
function optionParamKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The query parameter the Unified Inbox carries a chosen delivery service in.
 *  Not an option pick, so it is kept out of the picks below. */
const DELIVERY_PARAM = 'delivery-service'
const DELIVERY_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/

/** The delivery service a product link names, or null. */
function deliveryFromAddress(address: string): string | null {
  try {
    const key = new URL(address).searchParams.get(DELIVERY_PARAM)?.trim() ?? ''
    return DELIVERY_KEY.test(key) ? key : null
  } catch {
    return null
  }
}

/** The picks a shared product link carries: `?seat-colour=oxford-blue&width=1600mm`. */
function picksFromAddress(address: string): Map<string, string> {
  const picks = new Map<string, string>()
  try {
    new URL(address).searchParams.forEach((value, key) => {
      if (key === DELIVERY_PARAM) return
      if (value && !picks.has(key)) picks.set(key, value)
    })
  } catch {
    // An address that does not parse has no picks.
  }
  return picks
}

type PickedRow = {
  id: string
  name: string
  slug: string
  price: unknown
  sale_price: unknown
  tax_class_id: unknown
  image_url: string | null
  /** [option name, value slug, value label] in display order. */
  pairs: [string, string, string][] | null
}

/** The enabled variation of a listing that a link's picks name, when the link
 *  names one. A pick for an option the listing does not have is ignored; a pick
 *  that no variation shares settles nothing, so the listing stands as it is.
 *  Several matches (a partial pick) come back together for the caller to quote. */
async function pickedVariations(listingId: string, picks: Map<string, string>): Promise<{ rows: PickedRow[]; matched: [string, string, string][] } | null> {
  if (picks.size === 0) return null
  const rows = await prisma.$queryRaw<PickedRow[]>`
    SELECT c."id", c."name", c."slug", c."price", c."sale_price", c."tax_class_id",
           COALESCE(
             (SELECT m."url" FROM "shp_product_media" m
               WHERE m."product_id" = c."id" AND m."type" = 'IMAGE'
               ORDER BY m."is_primary" DESC, m."position" ASC
               LIMIT 1),
             (SELECT m."url" FROM "shp_product_media" m
               WHERE m."product_id" = v."product_id" AND m."type" = 'IMAGE'
               ORDER BY m."is_primary" DESC, m."position" ASC
               LIMIT 1)
           ) AS "image_url",
           (SELECT json_agg(json_build_array(o."name", ov."slug", ov."label") ORDER BY o."position" ASC, ov."position" ASC)
              FROM "svr_variant_values" vv
              JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
              JOIN "svr_options" o ON o."id" = ov."option_id"
             WHERE vv."variant_id" = v."id") AS "pairs"
      FROM "svr_variants" v
      JOIN "shp_products" c ON c."id" = v."child_product_id"
     WHERE v."product_id" = ${listingId} AND v."enabled" = true AND c."status" = 'ACTIVE'
     ORDER BY v."position" ASC
  `.catch(() => [] as PickedRow[])

  let best = 0
  let kept: PickedRow[] = []
  let matched: [string, string, string][] = []
  for (const row of rows) {
    let score = 0
    let conflict = false
    const hits: [string, string, string][] = []
    for (const [name, slug, label] of row.pairs ?? []) {
      const wanted = picks.get(optionParamKey(name))
      if (wanted === undefined) continue
      if (wanted === slug) { score += 1; hits.push([name, label, slug]) } else conflict = true
    }
    if (conflict || score === 0 || score < best) continue
    if (score > best) { best = score; kept = []; matched = hits }
    kept.push(row)
  }
  return kept.length > 0 ? { rows: kept, matched } : null
}

/** One product by its slug, or null when it is not on sale: a listing in the
 *  catalogue, or a switched-on variation (a hidden row published at its own
 *  slug). Anything else hidden is hidden on purpose. */
/** A product as a chat draws it, with the row its delivery is priced against:
 *  the exact variation where the address names one, the listing otherwise. */
type Found = { product: ChatProduct; id: string; taxClassId: unknown }

async function productBySlug(slug: string, s: Settings, picks: Map<string, string>): Promise<Found | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT p."id", p."name", p."slug", p."price", p."sale_price", p."tax_class_id", p."catalogue_hidden",
           (SELECT m."url" FROM "shp_product_media" m
             WHERE m."product_id" = p."id" AND m."type" = 'IMAGE'
             ORDER BY m."is_primary" DESC, m."position" ASC
             LIMIT 1) AS "image_url"
      FROM "shp_products" p
     WHERE p."slug" = ${slug} AND p."status" = 'ACTIVE'
     LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  const id = row.id as string
  const own = charged(row.price, row.sale_price, s.saleEnabled)
  const base = {
    url: pageOf(String(row.slug), s),
    name: (row.name as string) || 'Product',
    imageUrl: absoluteImage(row.image_url, s.siteUrl),
  }

  if (row.catalogue_hidden) {
    if (!s.variations) return null
    // A variation with no photograph of its own shows its listing's.
    const found = await prisma.$queryRaw<{ options: string | null; listing_image: string | null }[]>`
      SELECT (SELECT m."url" FROM "shp_product_media" m
               WHERE m."product_id" = v."product_id" AND m."type" = 'IMAGE'
               ORDER BY m."is_primary" DESC, m."position" ASC
               LIMIT 1) AS "listing_image",
             (SELECT string_agg(ov."label", ' / ' ORDER BY o."position" ASC, ov."position" ASC)
                FROM "svr_variant_values" vv
                JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
                JOIN "svr_options" o ON o."id" = ov."option_id"
               WHERE vv."variant_id" = v."id") AS "options"
        FROM "svr_variants" v
       WHERE v."child_product_id" = ${id} AND v."enabled" = true
       LIMIT 1
    `
    if (!found[0]) return null
    const options = found[0].options?.trim() || null
    const imageUrl = base.imageUrl ?? absoluteImage(found[0].listing_image, s.siteUrl)
    return { id, taxClassId: row.tax_class_id, product: { ...base, imageUrl, options, price: priceLine(own, false, row.tax_class_id, s) } }
  }

  // A listing with variations is quoted from its cheapest switched-on one, as
  // the storefront card quotes it; "From" only where they really differ. A range
  // photographed finish by finish keeps its pictures on the variations, so a
  // listing with none of its own borrows its first switched-on variation's.
  if (s.variations) {
    // A link carrying the shopper's picks is about that variation, not the range.
    const picked = await pickedVariations(id, picks)
    if (picked) {
      const [first] = picked.rows
      if (first && picked.rows.length === 1) {
        return {
          id: first.id,
          taxClassId: first.tax_class_id,
          product: {
            url: pageOf(first.slug, s),
            name: first.name || base.name,
            imageUrl: absoluteImage(first.image_url, s.siteUrl) ?? base.imageUrl,
            options: (first.pairs ?? []).map((p) => p[2]).join(' / ') || null,
            price: priceLine(charged(first.price, first.sale_price, s.saleEnabled), false, first.tax_class_id, s),
          },
        }
      }
      if (first) {
        const prices = picked.rows.map((r) => charged(r.price, r.sale_price, s.saleEnabled))
        const cheapest = Math.min(...prices)
        // The listing's page, with the picks kept so it opens preselected.
        const query = picked.matched
          .map((m) => `${encodeURIComponent(optionParamKey(m[0]))}=${encodeURIComponent(m[2])}`)
          .join('&')
        return {
          id,
          taxClassId: row.tax_class_id,
          product: {
            ...base,
            url: `${base.url}?${query}`,
            imageUrl: absoluteImage(first.image_url, s.siteUrl) ?? base.imageUrl,
            options: picked.matched.map((m) => m[1]).join(' / ') || null,
            price: priceLine(cheapest, Math.max(...prices) - cheapest > 0.005, row.tax_class_id, s),
          },
        }
      }
    }
    if (!base.imageUrl) {
      const borrowed = await prisma.$queryRaw<{ url: string }[]>`
        SELECT m."url"
          FROM "svr_variants" v
          JOIN "shp_product_media" m ON m."product_id" = v."child_product_id" AND m."type" = 'IMAGE'
         WHERE v."product_id" = ${id} AND v."enabled" = true
         ORDER BY v."position" ASC, m."is_primary" DESC, m."position" ASC
         LIMIT 1
      `.catch(() => [] as { url: string }[])
      base.imageUrl = absoluteImage(borrowed[0]?.url, s.siteUrl)
    }
    const range = await prisma.$queryRaw<{ cheapest: unknown; dearest: unknown }[]>`
      SELECT MIN(CASE WHEN ${s.saleEnabled} AND c."sale_price" IS NOT NULL AND c."sale_price" >= 0 AND c."sale_price" < c."price"
                      THEN c."sale_price" ELSE c."price" END) AS "cheapest",
             MAX(CASE WHEN ${s.saleEnabled} AND c."sale_price" IS NOT NULL AND c."sale_price" >= 0 AND c."sale_price" < c."price"
                      THEN c."sale_price" ELSE c."price" END) AS "dearest"
        FROM "svr_variants" v
        JOIN "shp_products" c ON c."id" = v."child_product_id"
       WHERE v."product_id" = ${id} AND v."enabled" = true
    `.catch(() => [] as { cheapest: unknown; dearest: unknown }[])
    const cheapest = toNumber(range[0]?.cheapest)
    if (cheapest !== null) {
      const varies = (toNumber(range[0]?.dearest) ?? cheapest) - cheapest > 0.005
      return { id, taxClassId: row.tax_class_id, product: { ...base, options: null, price: priceLine(cheapest, varies, row.tax_class_id, s) } }
    }
  }
  return { id, taxClassId: row.tax_class_id, product: { ...base, options: null, price: priceLine(own, false, row.tax_class_id, s) } }
}

/**
 * The delivery service a link names, priced for this product as the shop would
 * quote it today, or null where it is no longer offered for it.
 *
 * Read from whichever module publishes delivery services at
 * `shop.product-delivery-timing`, through core's generated registry rather than
 * an import - chat must build on a site with no such module, where the point is
 * simply empty. The figure arrives on the product's own side of tax and is taxed
 * at the product's own rate, so it is priced exactly as the product is.
 */
async function deliveryFor(key: string, found: Found, s: Settings): Promise<{ label: string; price: string } | null> {
  const { modulePublicExtensionPointComponents } = await import('@/lib/modules/extension-points.public')
  const registered: Record<string, unknown> = modulePublicExtensionPointComponents['shop.product-delivery-timing'] ?? {}
  const provider = Object.values(registered).find(
    (entry): entry is (ids: string[]) => Promise<Map<string, unknown>> => typeof entry === 'function',
  )
  if (!provider) return null
  const answered = await provider([found.id])
  const timing = answered instanceof Map ? answered.get(found.id) : null
  const options = timing && typeof timing === 'object' ? (timing as Record<string, unknown>).options : null
  for (const entry of Array.isArray(options) ? options : []) {
    if (!entry || typeof entry !== 'object') continue
    const option = entry as Record<string, unknown>
    if (option.key !== key) continue
    const label = typeof option.label === 'string' ? option.label.trim() : ''
    const amount = typeof option.price === 'number' && Number.isFinite(option.price) ? option.price : null
    if (!label || amount === null || amount < 0) return null
    return { label, price: priceLine(amount, false, found.taxClassId, s) ?? 'Free' }
  }
  return null
}

/**
 * The products behind every product address in these messages, keyed by the
 * address exactly as it was written. An address that is not one of ours, or is
 * of something no longer on sale, is simply absent - and so is everything when
 * the shop cannot be asked: a chat never fails over a product card.
 */
export async function productsForTexts(texts: readonly string[]): Promise<Map<string, ChatProduct>> {
  const out = new Map<string, ChatProduct>()
  const wanted = [...new Set(texts.flatMap((t) => productAddressesIn(t)))]
  if (wanted.length === 0) return out

  const now = Date.now()
  const missing: string[] = []
  for (const address of wanted) {
    const hit = cache.get(address)
    if (hit && now - hit.at < TTL_MS) {
      if (hit.product) out.set(address, hit.product)
    } else {
      missing.push(address)
    }
  }
  if (missing.length === 0) return out

  try {
    const settings = await readSettings()
    for (const address of missing.slice(0, 20)) {
      const slug = settings ? slugFromAddress(address, settings.siteUrl, settings.rootStyle) : null
      const found = slug && settings ? await productBySlug(slug, settings, picksFromAddress(address)) : null
      const key = found ? deliveryFromAddress(address) : null
      // A delivery that cannot be looked up costs the card its delivery line,
      // never the card.
      const delivery = found && key && settings
        ? await deliveryFor(key, found, settings).catch((err: unknown) => {
          console.error('[chat] could not look up a delivery service in a chat:', err)
          return null
        })
        : null
      const product = found ? (key ? { ...found.product, delivery } : found.product) : null
      if (cache.size >= CACHE_MAX) cache.clear()
      cache.set(address, { at: now, product })
      if (product) out.set(address, product)
    }
  } catch (err) {
    console.error('[chat] could not look up the products in a chat:', err)
  }
  return out
}

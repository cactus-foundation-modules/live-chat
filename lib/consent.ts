import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import type { ConsentBannerConfig } from '@/lib/consent/types'
import { CONSENT_CATEGORY } from './constants'

// The server's half of the Live chat cookie category.
//
// The widget already refuses to check in or send a message without a yes, and
// that is the half a visitor can see working. This is the half that matters when
// somebody posts to an endpoint directly: a consent gate that only lives in the
// browser is one request away from not existing at all.
//
// Core's cookie is read, never written, and only its `decision` map is looked
// at. The payload's shape belongs to core (lib/consent/client.ts); anything
// unreadable counts as "no decision", which denies.

const CONSENT_COOKIE = 'cactus-consent'

/**
 * 'category' - the banner is on and carries the Live chat category, so a visitor
 *   can be asked, and chatting and the visitor list both wait for a yes.
 * 'none' - the banner is off, or has no Live chat switch. Nobody can be asked,
 *   so chatting works as it always has (a visitor who writes in has asked for
 *   the chat) and the visitor list stays empty, because nobody agreed to it.
 */
export type ConsentGate = 'category' | 'none'

export type ConsentState = {
  gate: ConsentGate
  /** Handed to the widget when the gate is on, so it can save a yes exactly as
   *  the banner would (same cookie, same version, same audit record). */
  banner: ConsentBannerConfig | null
}

/** What the site's cookie banner currently offers. Read from core's own config
 *  rather than assumed: the category can be renamed, removed or never added. */
export async function getConsentState(): Promise<ConsentState> {
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { consentBannerConfig: true } })
    .catch(() => null)
  const banner = config?.consentBannerConfig as ConsentBannerConfig | null
  const carries = banner?.enabled === true && Array.isArray(banner.categories) && banner.categories.some((c) => c?.key === CONSENT_CATEGORY)
  return carries ? { gate: 'category', banner } : { gate: 'none', banner: null }
}

export function readConsentDecision(request: NextRequest): Record<string, boolean> | null {
  const raw = request.cookies.get(CONSENT_COOKIE)?.value
  if (!raw) return null
  try {
    const payload = JSON.parse(decodeURIComponent(raw)) as { decision?: Record<string, boolean> } | null
    if (!payload || typeof payload !== 'object' || !payload.decision) return null
    return payload.decision
  } catch {
    return null
  }
}

/** Has this visitor said yes to the Live chat category? */
export function hasChatConsent(request: NextRequest): boolean {
  return readConsentDecision(request)?.[CONSENT_CATEGORY] === true
}

/** May this visitor send a message? Always, where nobody can be asked. */
export function mayChat(request: NextRequest, gate: ConsentGate): boolean {
  return gate === 'none' || hasChatConsent(request)
}

/** May this visitor be on the visitor list? Only with a yes: a site whose banner
 *  never asks never gets one, so it never lists anybody. */
export function mayTrack(request: NextRequest, gate: ConsentGate): boolean {
  return gate === 'category' && hasChatConsent(request)
}

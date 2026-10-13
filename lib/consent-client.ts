'use client'

import { resolveCurrentDecision, saveConsentDecision } from '@/lib/consent/client'
import type { ConsentBannerConfig, ConsentDecision } from '@/lib/consent/types'
import { CONSENT_CATEGORY } from './constants'

// The widget's half of the Live chat cookie category. Every write goes through
// core's own saveConsentDecision, so a yes given in the chat window is the same
// cookie, the same version and the same audit record as one given on the banner.

export type ChatConsent = {
  /** They said yes to the Live chat category. */
  granted: boolean
  /** They have answered the banner (in its current version) at all. A visitor
   *  who answered and is not granted said no. */
  decided: boolean
}

export function readChatConsent(config: ConsentBannerConfig): ChatConsent {
  const { decision, storedAt } = resolveCurrentDecision(config)
  return { granted: storedAt !== null && decision[CONSENT_CATEGORY] === true, decided: storedAt !== null }
}

/**
 * Yes to Live chat, and nothing else. A visitor who already answered keeps every
 * other answer they gave. One who never answered the banner is recorded as
 * saying no to everything else that is optional, whatever the site's defaults
 * are: pressing "Allow live chat" is not agreeing to anything but live chat.
 */
export async function grantChatConsent(config: ConsentBannerConfig): Promise<void> {
  const { decision, storedAt } = resolveCurrentDecision(config)
  const next: ConsentDecision = {}
  for (const cat of config.categories) {
    next[cat.key] = cat.required ? true : storedAt !== null ? decision[cat.key] === true : false
  }
  next[CONSENT_CATEGORY] = true
  await saveConsentDecision(config, next, 'custom')
}

/** The site's cookie settings, opened on the switches. False when the page has
 *  no banner to open (the site switched it off since the page was served). */
export function openCookieSettings(): boolean {
  const api = typeof window !== 'undefined' ? window.cactusConsent : undefined
  if (!api || typeof api.open !== 'function') return false
  api.open()
  return true
}

'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import {
  API_BASE,
  PRESENCE_EVERY_MS,
  PRESENCE_HEADER,
  SHOP_CART_EVENT,
  SHOP_CART_STORAGE_KEY,
  VISITOR_HEADER,
} from '@/modules/chat/lib/constants'

// The visitor's browser checking in, so we can see who is on the site, where
// they have been and what is in their basket. Only ever switched on by the
// widget once the visitor has said yes to the Live chat cookie category.
//
// It checks in on arrival, on every page they move to, when their basket
// changes, and every half minute while the tab is in front (which is what keeps
// them on the "on the site now" list). A hidden tab checks in on its way back.
// A closing tab says so on its way out, so they leave the list at once; any
// other tab of ours still open hears about it and checks straight back in.

type CartLine = { productId: string; quantity: number }

/** Tabs of this site in one browser telling each other one of them closed. */
const TABS_CHANNEL = 'cactus-chat-presence'
/** Long enough for the closing tab's goodbye to land before the hello. */
const STILL_HERE_DELAY_MS = 1_500

/** The shop's basket from this browser, or undefined when there is no shop
 *  basket here at all. Read only; the shop owns it. */
function readCart(): CartLine[] | undefined {
  try {
    const raw = window.localStorage.getItem(SHOP_CART_STORAGE_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((l): l is CartLine => !!l && typeof l === 'object' && typeof (l as CartLine).productId === 'string')
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity) || 0 }))
  } catch {
    return undefined
  }
}

export type PresenceReply = { claim: string | null; chat: string | null; online?: boolean }

export function usePresence({
  enabled,
  presenceClaim,
  chatClaim,
  onReply,
  onRefused,
}: {
  enabled: boolean
  presenceClaim: () => string | undefined
  chatClaim: () => string | undefined
  onReply: (reply: PresenceReply) => void
  onRefused: () => void
}) {
  const pathname = usePathname()
  const lastCart = useRef<string | null>(null)
  const handlers = useRef({ presenceClaim, chatClaim, onReply, onRefused })
  useEffect(() => { handlers.current = { presenceClaim, chatClaim, onReply, onRefused } })
  const checkIn = useRef<(force?: boolean) => Promise<void>>(async () => {})

  useEffect(() => {
    if (!enabled) return
    let busy = false
    checkIn.current = async () => {
      if (busy) return
      busy = true
      try {
        const cart = readCart()
        const cartKey = cart === undefined ? null : JSON.stringify(cart)
        // The basket only travels when it changed (or the shop emptied it away).
        const sendCart = cartKey !== lastCart.current ? (cart ?? []) : undefined
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        const presence = handlers.current.presenceClaim()
        const chat = handlers.current.chatClaim()
        if (presence) headers[PRESENCE_HEADER] = presence
        if (chat) headers[VISITOR_HEADER] = chat
        const res = await fetch(`${API_BASE}/widget/presence`, {
          method: 'POST',
          headers,
          cache: 'no-store',
          keepalive: true,
          body: JSON.stringify({
            path: `${window.location.pathname}${window.location.search}`,
            title: document.title,
            referrer: presence ? undefined : document.referrer,
            cart: sendCart,
          }),
        })
        if (res.status === 403) { handlers.current.onRefused(); return }
        if (!res.ok) return
        lastCart.current = cartKey
        handlers.current.onReply((await res.json()) as PresenceReply)
      } catch {
        // The next check-in catches up.
      } finally {
        busy = false
      }
    }

    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!document.hidden) await checkIn.current()
      timer = setTimeout(tick, PRESENCE_EVERY_MS)
    }
    timer = setTimeout(tick, PRESENCE_EVERY_MS)
    const wake = () => { if (!document.hidden) void checkIn.current() }
    const cartChanged = () => { void checkIn.current() }

    let tabs: BroadcastChannel | null = null
    try { tabs = new BroadcastChannel(TABS_CHANNEL) } catch { /* one tab's word is good enough */ }
    let stillHere: ReturnType<typeof setTimeout> | undefined
    if (tabs) {
      tabs.onmessage = () => {
        clearTimeout(stillHere)
        stillHere = setTimeout(() => { void checkIn.current() }, STILL_HERE_DELAY_MS)
      }
    }
    // pagehide, not unload: it is the one that fires on phones and does not
    // stop the browser keeping the page for the back button.
    const leaving = () => {
      const presence = handlers.current.presenceClaim()
      if (!presence) return
      try {
        void fetch(`${API_BASE}/widget/leave`, {
          method: 'POST',
          headers: { [PRESENCE_HEADER]: presence },
          keepalive: true,
        }).catch(() => undefined)
      } catch { /* the online window catches them up within a minute and a half */ }
      tabs?.postMessage('left')
    }
    // Back from the back-button cache: here again.
    const returned = (e: PageTransitionEvent) => { if (e.persisted) void checkIn.current() }

    document.addEventListener('visibilitychange', wake)
    window.addEventListener(SHOP_CART_EVENT, cartChanged)
    window.addEventListener('pagehide', leaving)
    window.addEventListener('pageshow', returned)
    return () => {
      clearTimeout(timer)
      clearTimeout(stillHere)
      tabs?.close()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener(SHOP_CART_EVENT, cartChanged)
      window.removeEventListener('pagehide', leaving)
      window.removeEventListener('pageshow', returned)
      checkIn.current = async () => {}
    }
  }, [enabled])

  // Every page they move to, a moment after it lands so its title has too.
  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(() => { void checkIn.current() }, 400)
    return () => clearTimeout(t)
  }, [enabled, pathname])
}

/** Forget this visitor: their trail goes from our side as well as theirs. */
export async function forgetPresence(claim: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/widget/presence`, { method: 'DELETE', headers: { [PRESENCE_HEADER]: claim }, keepalive: true })
  } catch {
    // Pruned within the week regardless.
  }
}

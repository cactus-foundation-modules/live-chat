'use client'

import { useCallback, useEffect, useRef } from 'react'

// How the team's side of the chat stays current without anybody reloading:
// every view polls, and every view also looks again the moment something gives
// it reason to - the tab coming back into view, the window regaining focus, the
// connection returning, or a colleague's action in this browser (here or in
// another tab) nudging it. Client-only.

const NUDGE_EVENT = 'cactus-chat-admin-nudge'
const NUDGE_CHANNEL = 'cactus-chat-admin'

let channel: BroadcastChannel | null | undefined
function nudgeChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NUDGE_CHANNEL)
  } catch {
    channel = null
  }
  return channel
}

/** Something changed on our side - a reply, a chat read, ended or deleted, the
 *  Online switch flipped. Every admin view of the chat in this browser, in this
 *  tab and in any other, looks again now instead of on its next round. */
export function nudgeAdmin(): void {
  try { window.dispatchEvent(new Event(NUDGE_EVENT)) } catch { /* nothing listening */ }
  try { nudgeChannel()?.postMessage('nudge') } catch { /* the other tabs catch up on their own */ }
}

function subscribeNudge(listener: () => void): () => void {
  window.addEventListener(NUDGE_EVENT, listener)
  const ch = nudgeChannel()
  ch?.addEventListener('message', listener)
  return () => {
    window.removeEventListener(NUDGE_EVENT, listener)
    ch?.removeEventListener('message', listener)
  }
}

/**
 * Runs `run` now, then every `everyMs` while the tab is in front (`hiddenMs`
 * while it is not), never two at once: a call that lands mid-flight runs once
 * more when the first finishes, so nothing it was asked to catch is missed.
 * A change of `key` starts over with an immediate run. Returns a function that
 * runs it straight away.
 */
export function usePolling(run: () => Promise<void>, opts: { everyMs: number; hiddenMs: number; enabled?: boolean; key?: string }): () => void {
  const { everyMs, hiddenMs, enabled = true, key = '' } = opts
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })
  const kick = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let busy = false
    let again = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let soon: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      clearTimeout(timer)
      if (alive) timer = setTimeout(() => { void tick() }, document.hidden ? hiddenMs : everyMs)
    }
    const tick = async () => {
      if (!alive) return
      if (busy) { again = true; return }
      busy = true
      clearTimeout(timer)
      try { await runRef.current() } catch { /* the next round will catch up */ }
      busy = false
      if (!alive) return
      if (again) { again = false; void tick(); return }
      schedule()
    }
    const now = () => { void tick() }
    const visible = () => { if (!document.hidden) now() }
    // A burst of nudges (one action fans out to several views) is one look.
    const nudged = () => { clearTimeout(soon); soon = setTimeout(now, 120) }

    kick.current = now
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    window.addEventListener('online', now)
    const stop = subscribeNudge(nudged)
    now()
    return () => {
      alive = false
      clearTimeout(timer)
      clearTimeout(soon)
      kick.current = () => {}
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', visible)
      window.removeEventListener('online', now)
      stop()
    }
  }, [enabled, everyMs, hiddenMs, key])

  return useCallback(() => kick.current(), [])
}

// The Online/Offline switch, shared by every place it shows on the page. The
// chat list carries its value on every poll, so a colleague flipping it
// elsewhere shows here within seconds.
let availability: boolean | null = null
let heldUntil = 0
const availabilityListeners = new Set<() => void>()

/** A poll's answer, which loses to a flip made on this page in the last few
 *  seconds: that poll may have left before the flip landed. */
export function availabilityFromServer(next: boolean): void {
  if (Date.now() < heldUntil) return
  publishAvailability(next)
}

/** Set here and now (the switch itself), holding off older poll answers. */
export function publishAvailability(next: boolean | null, holdMs = 0): void {
  if (holdMs > 0) heldUntil = Date.now() + holdMs
  if (next === availability) return
  availability = next
  availabilityListeners.forEach((l) => l())
}
export function readAvailability(): boolean | null {
  return availability
}
export function subscribeAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener)
  return () => { availabilityListeners.delete(listener) }
}

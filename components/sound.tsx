'use client'

import { useEffect, useState } from 'react'

// Little sounds made in the browser, so there is no sound file to host. Browsers
// only let a page make noise once the person has touched it, so the context is
// made (and woken) on their first tap or key press anywhere.

let audio: AudioContext | null = null
function audioContext(): AudioContext | null {
  if (audio) return audio
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor) audio = new Ctor()
  } catch { /* no audio here */ }
  return audio
}

export function unlockAudio() {
  const ctx = audioContext()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {})
}

function tones(notes: { freq: number; offset: number; length: number; level: number }[]) {
  const ctx = audioContext()
  if (!ctx || ctx.state !== 'running') return
  const now = ctx.currentTime
  notes.forEach(({ freq, offset, length, level }) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + offset)
    gain.gain.exponentialRampToValueAtTime(level, now + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + length)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + offset)
    osc.stop(now + offset + length + 0.05)
  })
}

// Two notes, going up: a message has arrived. Two polls landing together
// (the list and the open chat) must not sound it twice.
let lastChime = 0
export function playChime() {
  const at = Date.now()
  if (at - lastChime < 1500) return
  lastChime = at
  tones([{ freq: 880, offset: 0, length: 0.45, level: 0.18 }, { freq: 1174.66, offset: 0.14, length: 0.45, level: 0.18 }])
}

// For our own team: a message left unanswered keeps chiming until someone
// touches the page (a click, key press or tap anywhere) or mutes it, so it
// cannot be missed from across the room. Starting while already ringing does
// nothing extra.
const ALERT_EVERY_MS = 5000
const ALERT_STOPPERS = ['pointerdown', 'keydown', 'touchstart'] as const
let alertTimer: ReturnType<typeof setInterval> | null = null

export function stopAlert() {
  if (alertTimer === null) return
  clearInterval(alertTimer)
  alertTimer = null
  ALERT_STOPPERS.forEach((e) => window.removeEventListener(e, stopAlert))
}

export function startAlert() {
  playChime()
  if (alertTimer !== null) return
  alertTimer = setInterval(playChime, ALERT_EVERY_MS)
  ALERT_STOPPERS.forEach((e) => window.addEventListener(e, stopAlert, { passive: true }))
}

// One short, softer blip: your own message has gone.
export function playSent() {
  tones([{ freq: 660, offset: 0, length: 0.18, level: 0.1 }])
}

// The mute choice for our own team, kept in this browser. (A visitor's lives
// with the rest of what their widget remembers.)
const ADMIN_MUTE_KEY = 'cactus-chat-admin-muted'
export function loadAdminMuted(): boolean {
  try { return localStorage.getItem(ADMIN_MUTE_KEY) === '1' } catch { return false }
}
export function saveAdminMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(ADMIN_MUTE_KEY, '1')
    else localStorage.removeItem(ADMIN_MUTE_KEY)
  } catch { /* the choice just will not stick */ }
  try { window.dispatchEvent(new Event('cactus-chat-admin-muted')) } catch { /* nothing listening */ }
}
export function subscribeAdminMuted(onChange: () => void): () => void {
  window.addEventListener('cactus-chat-admin-muted', onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener('cactus-chat-admin-muted', onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={muted ? 'Unmute new message sound' : 'Mute new message sound'}
      aria-pressed={muted}
      title={muted ? 'Sound off - click to turn on' : 'Sound on - click to mute'}
      onClick={onToggle}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        {muted ? <path d="M23 9l-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
      </svg>
    </button>
  )
}

// Hook for the team side: the saved choice, kept in step across every place
// the chat is open in this browser.
export function useAdminMuted(): [boolean, () => void] {
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice lives in the browser, so it can only be read here
    setMuted(loadAdminMuted())
    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    const wake = () => { unlockAudio(); events.forEach((e) => window.removeEventListener(e, wake)) }
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }))
    const stop = subscribeAdminMuted(() => setMuted(loadAdminMuted()))
    return () => { stop(); events.forEach((e) => window.removeEventListener(e, wake)) }
  }, [])
  function toggle() {
    unlockAudio()
    const next = !loadAdminMuted()
    saveAdminMuted(next)
    if (next) stopAlert()
    else playChime()
  }
  return [muted, toggle]
}

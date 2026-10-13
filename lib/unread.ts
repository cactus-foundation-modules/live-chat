// The unread count, shared between whichever surface is on the page (the
// visitor's widget, or a colleague's bubble) and the Mobile Bar cell, which are
// separate client components with nothing else in common. Client-only.

let count = 0
const listeners = new Set<() => void>()

export function publishUnread(next: number): void {
  if (next === count) return
  count = next
  listeners.forEach((l) => l())
}

export function readUnread(): number {
  return count
}

export function subscribeUnread(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

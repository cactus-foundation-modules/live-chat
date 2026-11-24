import { after } from 'next/server'

// Work nobody should wait for: the push to a visitor's browser, the bell, the
// word to the Unified Inbox. Inside a request it runs once the response has
// gone (next/server `after`). Outside one - a module answering chats from its
// own timer, or from inside an `after` of its own on a host that refuses a
// nested one - `after` throws, and the work simply runs now instead. Either
// way it is never lost and never throws back at the caller.

export function later(task: () => Promise<void>): void {
  const run = () => task().catch((err: unknown) => { console.error('[chat] a background step failed', err) })
  try {
    after(run)
  } catch {
    void run()
  }
}

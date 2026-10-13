'use client'

import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from '@/modules/chat/lib/constants'
import type { ClientListedVisitor, ClientMessage, ClientVisitor } from '@/modules/chat/lib/serialise'
import { Composer, messageRequest, readError, timeLabel } from './ui'

// Who is on the site right now, from our side: used by the inbox tab and by the
// bubble a signed-in colleague sees on the site. Only visitors who said yes to
// the Live chat cookie category are ever here.

export type VisitorsReason = 'off' | 'no-category' | null

export function useVisitors(enabled: boolean, everyMs: number) {
  const [visitors, setVisitors] = useState<ClientListedVisitor[]>([])
  const [reason, setReason] = useState<VisitorsReason>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/visitors`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { visitors: ClientListedVisitor[]; reason: VisitorsReason }
      setVisitors(json.visitors)
      setReason(json.reason)
      setLoaded(true)
    } catch { /* next round */ }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await refresh()
      timer = setTimeout(tick, document.hidden ? Math.max(everyMs, 30_000) : everyMs)
    }
    void tick()
    return () => clearTimeout(timer)
  }, [enabled, refresh, everyMs])

  return { visitors, reason, loaded, refresh }
}

/** "4 min", "1 hr 5 min": how long between two moments, for people. */
export function spanLabel(fromIso: string, to = Date.now()): string {
  const mins = Math.max(0, Math.round((to - new Date(fromIso).getTime()) / 60_000))
  if (mins < 1) return 'under a minute'
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  return mins % 60 ? `${hrs} hr ${mins % 60} min` : `${hrs} hr`
}

function pageName(path: string | null, title: string | null): string {
  return title || path || 'a page'
}

export function visitorLabel(v: ClientListedVisitor): string {
  return v.name || v.email || (v.device ? `Visitor on a ${v.device.toLowerCase()}` : 'Visitor')
}

export function VisitorList({ visitors, reason, loaded, activeId, onPick }: {
  visitors: ClientListedVisitor[]
  reason: VisitorsReason
  loaded: boolean
  activeId?: string | null
  onPick: (v: ClientListedVisitor) => void
}) {
  if (!loaded) return <div className="cch-list"><p className="cch-muted" style={{ padding: 14 }}>Loading…</p></div>
  if (reason) {
    return (
      <div className="cch-list">
        <p className="cch-muted" style={{ padding: 14 }}>
          {reason === 'off'
            ? 'The visitor list is switched off in Settings > Live Chat.'
            : 'Nobody can be listed until your cookie banner carries the Live chat switch and visitors say yes to it. Add it on the GDPR tab of Settings.'}
        </p>
      </div>
    )
  }
  if (visitors.length === 0) {
    return <div className="cch-list"><p className="cch-muted" style={{ padding: 14 }}>Nobody about who has agreed to be listed. Put the kettle on.</p></div>
  }
  return (
    <div className="cch-list">
      {visitors.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`cch-item${v.unread > 0 ? ' unread' : ''}${v.id === activeId ? ' active' : ''}`}
          onClick={() => onPick(v)}
        >
          <div className="cch-item-top">
            <span>{visitorLabel(v)}</span>
            <span className="cch-item-tags">
              {v.conversationStatus === 'open' ? <span className="cch-tag">Chatting</span> : null}
              {v.cart ? <span className="cch-tag">Basket {v.cart.reduce((n, l) => n + l.quantity, 0)}</span> : null}
            </span>
          </div>
          <div className="cch-item-preview">
            On {pageName(v.currentPath, v.currentTitle)} · here {spanLabel(v.firstSeenAt)} · {v.pageViews} page{v.pageViews === 1 ? '' : 's'}
          </div>
        </button>
      ))}
    </div>
  )
}

/** Where they are, where they have been and what is in their basket. */
export function VisitorDetails({ visitor }: { visitor: ClientVisitor }) {
  const trail = [...visitor.pages].reverse()
  return (
    <div className="cch-visitor">
      <p>
        <span className={`cch-presence${visitor.online ? ' on' : ''}`} aria-hidden="true" />
        {visitor.online ? 'On ' : 'Last seen on '}
        {visitor.currentPath ? <a href={visitor.currentPath} target="_blank" rel="noopener noreferrer">{pageName(visitor.currentPath, visitor.currentTitle)}</a> : 'a page'}
        {visitor.online ? null : <> {spanLabel(visitor.lastSeenAt)} ago</>}
      </p>
      <p className="cch-muted">
        Here {spanLabel(visitor.firstSeenAt, new Date(visitor.lastSeenAt).getTime())}
        {visitor.device ? <> · {visitor.device}</> : null}
        {visitor.referrer ? <> · came from {visitor.referrer}</> : null}
      </p>

      <h3>Basket</h3>
      {visitor.cart ? (
        <ul className="cch-cart">
          {visitor.cart.map((l) => (
            <li key={l.productId}>
              <span>{l.quantity} × {l.name ?? 'an item we could not find'}</span>
              {l.unitPrice ? <span className="cch-muted">{(Number(l.unitPrice) * l.quantity).toFixed(2)}</span> : null}
            </li>
          ))}
          {visitor.cartTotal ? <li className="cch-cart-total"><span>Total</span><span>{visitor.cartTotal}</span></li> : null}
        </ul>
      ) : <p className="cch-muted">Empty, or no shop on this site.</p>}

      <h3>Pages, newest first</h3>
      <ol className="cch-trail">
        {trail.map((p, i) => (
          <li key={`${p.at}-${i}`}>
            <a href={p.path} target="_blank" rel="noopener noreferrer" title={p.path}>{pageName(p.path, p.title)}</a>
            <time dateTime={p.at} className="cch-muted">{timeLabel(p.at)}</time>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** One visitor from our side, with a box to say hello first. A visitor already
 *  chatting is handed to their chat instead. */
export function VisitorPanel({ visitor: listed, canReply, onBack, onChat, compact }: {
  visitor: ClientListedVisitor
  canReply: boolean
  onBack: () => void
  onChat: (conversationId: string) => void
  compact?: boolean
}) {
  const [visitor, setVisitor] = useState<ClientVisitor>(listed)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let live = true
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/visitors/${listed.id}`, { cache: 'no-store' })
        if (res.status === 404 && live) setGone(true)
        if (res.ok && live) setVisitor(((await res.json()) as { visitor: ClientVisitor }).visitor)
      } catch { /* next round */ }
      if (live) timer = setTimeout(tick, document.hidden ? 30_000 : 5_000)
    }
    timer = setTimeout(tick, 5_000)
    return () => { live = false; clearTimeout(timer) }
  }, [listed.id])

  async function sayHello(body: string, files: File[]): Promise<boolean> {
    const res = await fetch(`${API_BASE}/admin/visitors/${listed.id}/chat`, messageRequest({ body }, files))
    if (!res.ok) throw new Error(await readError(res))
    const json = (await res.json()) as { conversationId: string; message: ClientMessage }
    onChat(json.conversationId)
    return true
  }

  const chatting = listed.conversationStatus === 'open' && listed.conversationId
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="cch-head" style={compact ? undefined : { background: 'var(--color-surface)', color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>
        <button type="button" aria-label="Back to visitors" onClick={onBack}>←</button>
        <h2 title={visitorLabel(listed)}>{visitorLabel(listed)}</h2>
        {listed.conversationId ? <button type="button" onClick={() => onChat(listed.conversationId!)}>{chatting ? 'Open chat' : 'Last chat'}</button> : null}
      </div>
      <div className="cch-body">
        {gone ? <p className="cch-muted">This visitor has left and their trail has been cleared.</p> : <VisitorDetails visitor={visitor} />}
      </div>
      {canReply && !gone ? (
        chatting
          ? <div className="cch-muted" style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>Already chatting with you - open the chat to reply.</div>
          : <Composer onSend={sayHello} placeholder="Say hello first…" />
      ) : null}
    </div>
  )
}

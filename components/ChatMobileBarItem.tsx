'use client'

import { useSyncExternalStore } from 'react'
import { CHAT_OPEN_EVENT } from '@/modules/chat/lib/constants'
import { readUnread, subscribeUnread } from '@/modules/chat/lib/unread'
import type { ModuleMobileBarItemProps } from '@/lib/puck/mobileBar'

// This module's cell in core's Mobile Bar (`core.mobile-bar-items`): a message
// icon that opens the chat. It draws none of its own chrome - the .cmb-*
// classes are core's - and starts nothing itself: it fires the event the
// widget (or a colleague's bubble) answers. The Live Chat block still has to be
// in the header or footer; with no widget on the page, nothing answers.
export function ChatMobileBarItem({ label, showLabels }: ModuleMobileBarItemProps) {
  const caption = (label || '').trim()
  const unread = useSyncExternalStore(subscribeUnread, readUnread, () => 0)
  const name = caption || 'Live chat'
  return (
    <button
      type="button"
      className="cmb-item"
      aria-label={unread > 0 ? `${name} - ${unread} unread` : name}
      onClick={() => window.dispatchEvent(new Event(CHAT_OPEN_EVENT))}
    >
      <span className="cmb-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unread > 0 && <span className="cmb-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </span>
      {showLabels === 'yes' && caption ? <span className="cmb-label">{caption}</span> : null}
    </button>
  )
}

'use client'

import { useState } from 'react'
import { ChatStyles } from './ui'
import { AgentThread, ConversationList, useChatList } from './AgentThread'
import { AvailabilitySwitch, useAvailability } from './AvailabilitySwitch'

// The Live chat tab of the admin Inbox: chats down the side, the chosen one
// beside them. Everything refreshes on its own every few seconds.

export function AdminInbox({ canReply, canManage, initialId }: { canReply: boolean; canManage: boolean; initialId: string | null }) {
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const [active, setActive] = useState<string | null>(initialId)
  const { conversations, unread, loaded, refresh } = useChatList(status, 5_000)
  const availability = useAvailability()

  return (
    <div className="cch-root" style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', height: 'calc(100vh - 220px)', minHeight: 420, background: 'var(--color-surface)' }}>
      <ChatStyles />
      <div style={{ width: 300, maxWidth: '40%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)' }}>
        <div className="cch-row" style={{ padding: 10, borderBottom: '1px solid var(--color-border)' }} role="tablist">
          <button type="button" role="tab" aria-selected={status === 'open'} className={`cch-btn${status === 'open' ? ' primary' : ''}`} onClick={() => setStatus('open')}>
            Open{unread > 0 ? ` (${unread})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={status === 'closed'} className={`cch-btn${status === 'closed' ? ' primary' : ''}`} onClick={() => setStatus('closed')}>
            Ended
          </button>
          {canReply ? <span style={{ marginLeft: 'auto' }}><AvailabilitySwitch online={availability.online} busy={availability.busy} onChange={availability.change} /></span> : null}
        </div>
        {loaded ? (
          <ConversationList
            conversations={conversations}
            activeId={active}
            onPick={setActive}
            empty={status === 'open' ? 'No open chats. Enjoy the peace while it lasts.' : 'No ended chats yet.'}
          />
        ) : <p className="cch-muted" style={{ padding: 14 }}>Loading…</p>}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--color-bg-subtle)' }}>
        {active ? (
          <AgentThread key={active} id={active} canReply={canReply} canManage={canManage} onChanged={refresh} onBack={() => setActive(null)} />
        ) : (
          <p className="cch-muted" style={{ margin: 'auto' }}>Pick a chat to read it.</p>
        )}
      </div>
    </div>
  )
}

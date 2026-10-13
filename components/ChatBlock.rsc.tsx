import { connection } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { getChatSettings } from '@/modules/chat/lib/settings'
import { getConsentState } from '@/modules/chat/lib/consent'
import { PERM_REPLY, PERM_VIEW } from '@/modules/chat/lib/constants'
import { chatBlockComponent } from './ChatBlock'
import { VisitorWidget } from './VisitorWidget'
import { AgentBubble } from './AgentBubble'

async function ChatRsc() {
  await connection()
  const settings = await getChatSettings()
  if (!settings.enabled) return null

  // Colleagues browsing the site answer chats from here rather than chatting
  // with themselves through the visitor's widget.
  const user = await getSessionFromCookie().catch(() => null)
  if (user && await hasPermission(user, PERM_VIEW).catch(() => false)) {
    const canReply = await hasPermission(user, PERM_REPLY).catch(() => false)
    return <AgentBubble position={settings.position} canReply={canReply} hideOnMobile={settings.hideBubbleOnMobile} />
  }
  const consent = await getConsentState()
  return (
    <VisitorWidget
      position={settings.position}
      label={settings.bubbleLabel || 'Chat with us'}
      greeting={settings.greeting}
      transcripts={settings.transcripts}
      hideOnMobile={settings.hideBubbleOnMobile}
      online={settings.online}
      awayLabel={settings.awayLabel}
      awayMessage={settings.awayMessage}
      consent={consent.banner}
      track={settings.trackVisitors && consent.gate === 'category'}
    />
  )
}

export const chatBlockRscComponent = { ...chatBlockComponent, render: ChatRsc }

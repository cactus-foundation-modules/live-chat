import { connection } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { getChatSettings } from '@/modules/chat/lib/settings'
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
    return <AgentBubble position={settings.position} canReply={canReply} />
  }
  return (
    <VisitorWidget
      position={settings.position}
      label={settings.bubbleLabel || 'Chat with us'}
      greeting={settings.greeting}
      transcripts={settings.transcripts}
    />
  )
}

export const chatBlockRscComponent = { ...chatBlockComponent, render: ChatRsc }

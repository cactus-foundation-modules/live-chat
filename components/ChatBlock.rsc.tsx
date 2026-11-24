import { cookies } from 'next/headers'
import { connection } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { getChatSettings } from '@/modules/chat/lib/settings'
import { getConsentState } from '@/modules/chat/lib/consent'
import { visitorFacingOnline } from '@/modules/chat/lib/responder'
import { resolveChatSlots } from '@/modules/chat/lib/slots.server'
import { AS_VISITOR_COOKIE, PERM_REPLY, PERM_VIEW } from '@/modules/chat/lib/constants'
import { chatBlockComponent } from './ChatBlock'
import { VisitorWidget } from './VisitorWidget'
import { AgentBubble } from './AgentBubble'

async function ChatRsc() {
  await connection()
  const settings = await getChatSettings()
  if (!settings.enabled) return null

  // Colleagues browsing the site answer chats from here rather than chatting
  // with themselves through the visitor's widget - unless they have asked to
  // see it as a visitor does (components/visitor-view.ts), in which case they
  // get the visitor's widget with a way back.
  const user = await getSessionFromCookie().catch(() => null)
  const colleague = !!user && await hasPermission(user, PERM_VIEW).catch(() => false)
  const asVisitor = colleague && (await cookies()).get(AS_VISITOR_COOKIE)?.value === '1'
  if (colleague && !asVisitor && user) {
    const [canReply, slots] = await Promise.all([hasPermission(user, PERM_REPLY).catch(() => false), resolveChatSlots()])
    return (
      <AgentBubble
        position={settings.position}
        canReply={canReply}
        hideOnMobile={settings.hideBubbleOnMobile}
        adminToolbar={slots.adminToolbar}
        conversationActions={slots.conversationActions}
      />
    )
  }
  // Online when the switch is, or when another module is answering visitors
  // (lib/responder.ts). Which visitor is not known here: the widget asks again
  // with its claim as soon as it checks in.
  const [consent, online, slots] = await Promise.all([getConsentState(), visitorFacingOnline(settings.online, null), resolveChatSlots()])
  return (
    <VisitorWidget
      position={settings.position}
      label={settings.bubbleLabel || 'Chat with us'}
      greeting={settings.greeting}
      transcripts={settings.transcripts}
      hideOnMobile={settings.hideBubbleOnMobile}
      online={online}
      awayLabel={settings.awayLabel}
      awayMessage={settings.awayMessage}
      consent={consent.banner}
      track={settings.trackVisitors && consent.gate === 'category'}
      productActions={slots.productActions}
      asColleague={asVisitor}
    />
  )
}

export const chatBlockRscComponent = { ...chatBlockComponent, render: ChatRsc }

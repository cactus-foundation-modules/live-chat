import { AS_VISITOR_COOKIE } from '@/modules/chat/lib/constants'

// A colleague's "see it as a visitor" switch. The bubble on the site normally
// shows colleagues the team's view (chats to answer, who is on the site); this
// swaps it for the visitor's own chat window, so a colleague can see what
// visitors see and send a message the way they would - to check the greeting
// and the away message, or to try anything that answers visitors. The server
// reads the cookie (components/ChatBlock.rsc.tsx) only alongside a signed-in
// colleague's session, so it changes nothing for anybody else.

export function setVisitorView(on: boolean): void {
  document.cookie = on
    ? `${AS_VISITOR_COOKIE}=1; path=/; SameSite=Lax`
    : `${AS_VISITOR_COOKIE}=; path=/; SameSite=Lax; max-age=0`
  window.location.reload()
}

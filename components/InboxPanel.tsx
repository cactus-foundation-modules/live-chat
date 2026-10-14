import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { PERM_MANAGE, PERM_REPLY, PERM_VIEW } from '@/modules/chat/lib/constants'
import { AdminInbox } from './AdminInbox'

// Live chat as a tab on core's shared Inbox page (`core.inbox-tabs`). The
// permission check stays here: a panel that renders whatever it is handed is
// one refactor away from showing chats to somebody who may not read them.
export async function ChatInboxPanel({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> } = {}) {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, PERM_VIEW)) {
    return <div className="alert alert-danger">You do not have permission to view live chats.</div>
  }
  const [canReply, canManage] = await Promise.all([hasPermission(user, PERM_REPLY), hasPermission(user, PERM_MANAGE)])
  const id = typeof searchParams?.id === 'string' && /^[a-f0-9]{24}$/.test(searchParams.id) ? searchParams.id : null
  return <AdminInbox canReply={canReply} canManage={canManage} initialId={id} initialTab={searchParams?.visitors === '1' && !id ? 'visitors' : 'open'} />
}

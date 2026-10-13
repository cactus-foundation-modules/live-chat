import { sendEmail } from '@/lib/email/index'
import { getSiteEmailContext } from '@/lib/email/render'
import { getEmailPalette, resolveEmailWrapper, wrapEmailHtml } from '@/lib/email/wrapper'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { API_BASE, MODULE_NAME } from './constants'
import type { ChatConversation, ChatMessage } from './db'
import { attachmentSignature } from './visitor'

// The chat, written out as an email for the visitor to keep.

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function when(date: Date): string {
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

function who(message: ChatMessage, siteName: string): string {
  if (message.sender === 'visitor') return 'You'
  return message.authorName || siteName
}

export async function sendTranscript(to: string, conversation: ChatConversation, messages: ChatMessage[]): Promise<void> {
  const [palette, layout, site] = await Promise.all([getEmailPalette(), resolveEmailWrapper(null), getSiteEmailContext()])
  const base = getSiteUrlOrNull() ?? ''
  const subject = `Your chat with ${site.siteName}`
  const visible = messages.filter((m) => m.sender !== 'system')

  const rows = visible.map((m) => {
    const files = m.attachments.map((a) => {
      const href = `${base}${API_BASE}/attachments/${a.id}?sig=${attachmentSignature(a.id)}`
      return `<div style="margin-top:4px">📎 <a href="${escapeHtml(href)}">${escapeHtml(a.filename)}</a></div>`
    }).join('')
    const body = m.body ? escapeHtml(m.body).replace(/\n/g, '<br>') : ''
    return `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e5e5">
      <div style="font-size:12px;opacity:.7">${escapeHtml(who(m, site.siteName))} · ${escapeHtml(when(m.createdAt))}</div>
      <div style="margin-top:2px">${body}${files}</div>
    </td></tr>`
  }).join('')

  const bodyHtml = `<p>Here is a copy of your chat with us on ${escapeHtml(when(conversation.createdAt))}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="margin-top:16px">Thanks for getting in touch.</p>`

  const text = [
    `Here is a copy of your chat with us on ${when(conversation.createdAt)}.`,
    '',
    ...visible.map((m) => {
      const files = m.attachments.map((a) => `  [${a.filename}] ${base}${API_BASE}/attachments/${a.id}?sig=${attachmentSignature(a.id)}`)
      return [`${who(m, site.siteName)} (${when(m.createdAt)}):`, m.body, ...files, ''].join('\n')
    }),
    'Thanks for getting in touch.',
  ].join('\n')

  const html = wrapEmailHtml({
    bodyHtml,
    subject,
    vars: { siteName: site.siteName, siteUrl: site.siteUrl, logoUrl: site.logoUrl, year: site.year },
    palette,
    layout,
  })

  await sendEmail({ to, subject, html, text, moduleName: MODULE_NAME, threadKey: `chat:${conversation.id}` })
}

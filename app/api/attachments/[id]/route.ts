import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getAttachment } from '@/modules/chat/lib/db'
import { loadFile } from '@/modules/chat/lib/attachments'
import { isInlineImage } from '@/modules/chat/lib/files'
import { attachmentSignatureValid } from '@/modules/chat/lib/visitor'
import { PERM_VIEW } from '@/modules/chat/lib/constants'

// The only way to a chat attachment: a signed link (what the visitor and their
// transcript are given) or an admin session that may read chats.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[a-f0-9]{32}$/.test(id)) return errorResponse('Not found', 404)

  if (!attachmentSignatureValid(id, request.nextUrl.searchParams.get('sig'))) {
    const user = await getSessionFromCookie()
    if (!user || !await hasPermission(user, PERM_VIEW)) return errorResponse('Not found', 404)
  }

  const attachment = await getAttachment(id)
  if (!attachment) return errorResponse('That file no longer exists.', 404)

  let buffer: Buffer
  try {
    buffer = await loadFile(attachment)
  } catch {
    return errorResponse('That file could not be fetched from storage.', 502)
  }

  // Pictures may show in place; everything else downloads, so nothing a
  // stranger uploaded can render as a page on the site's own origin.
  const inline = isInlineImage(attachment.contentType)
  const filename = attachment.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': inline ? attachment.contentType : 'application/octet-stream',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  })
}

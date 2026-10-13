import { CHAT_WORKER_SOURCE } from '@/modules/chat/lib/worker'

// Open to anybody: the same few lines for every visitor, holding nothing.
export const dynamic = 'force-dynamic'

export function GET() {
  return new Response(CHAT_WORKER_SOURCE, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, max-age=0',
    },
  })
}

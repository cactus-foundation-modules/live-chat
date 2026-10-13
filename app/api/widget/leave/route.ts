import { NextRequest, NextResponse } from 'next/server'
import { markVisitorLeft, visitorFromRequest } from '@/modules/chat/lib/visitors'

// A visitor's browser on its way out: the tab closed, or went to another site.
// Sent as the page unloads, so nobody reads the answer. A reload or another tab
// still open checks in again straight after, which puts them back on the list.
export async function POST(request: NextRequest) {
  const claim = await visitorFromRequest(request).catch(() => null)
  if (claim) await markVisitorLeft(claim.id).catch(() => undefined)
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

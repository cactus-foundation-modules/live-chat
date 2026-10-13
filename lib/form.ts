import type { NextRequest } from 'next/server'
import { MAX_MESSAGE_CHARS } from './constants'

/** A message as posted: multipart when files come with it, JSON otherwise. */
export async function readMessageForm(request: NextRequest): Promise<{ fields: Record<string, string>; files: File[] } | null> {
  const type = request.headers.get('content-type') ?? ''
  try {
    if (type.includes('multipart/form-data')) {
      const form = await request.formData()
      const fields: Record<string, string> = {}
      const files: File[] = []
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') fields[key] = value
        else if (key === 'files' && value.size > 0) files.push(value)
      }
      return { fields, files }
    }
    const json = (await request.json()) as Record<string, unknown>
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(json ?? {})) if (typeof value === 'string') fields[key] = value
    return { fields, files: [] }
  } catch {
    return null
  }
}

export function messageBody(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_MESSAGE_CHARS)
}

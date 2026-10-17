import { BLOCKED_EXTENSION_LIST, MAX_ATTACHMENT_BYTES, MAX_FILES_PER_MESSAGE } from './files'

// Pure helpers shared by the routes, the provider and the browser.
import { withoutLinks } from './links'

const PREVIEW_CHARS = 140

/** One line of a message for a list, or null when there are no words in it. */
export function previewOf(text: string | null | undefined): string | null {
  if (!text) return null
  const flat = withoutLinks(text).replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null
}

export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim().slice(0, 80)
  return name || null
}

/**
 * A phone number in whatever shape a person types it, tidied to digits with no
 * spaces: "07332 342 234", "+44 7332 342 234" and "+44 (0)7332 342234" all come
 * back as 07332342234. A UK number always comes back in its 0 form; any other
 * country keeps its + and country code. Null when it cannot be a phone number.
 */
export function cleanPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let text = value.trim()
  if (!text || text.length > 40) return null
  if (/[^\d\s+().\-]/.test(text)) return null
  text = text.replace(/\(0\)/g, '')
  let digits = text.replace(/\D/g, '')
  const international = text.startsWith('+') || digits.startsWith('00')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (international || (digits.startsWith('44') && digits.length === 12)) {
    if (digits.startsWith('44')) digits = `0${digits.slice(2)}`
    else return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null
  }
  if (digits.startsWith('0') && (digits.length < 10 || digits.length > 11)) return null
  return digits.length >= 7 && digits.length <= 15 ? digits : null
}

/** Why a file cannot be attached, in words a visitor can act on, or null. */
export function fileProblem(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return `"${file.name}" is empty.`
  if (file.size > MAX_ATTACHMENT_BYTES) return `"${file.name}" is over the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit.`
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : ''
  if (BLOCKED_EXTENSION_LIST.includes(ext)) return `"${file.name}" is a kind of file we cannot accept.`
  return null
}

export function filesProblem(files: Array<{ name: string; size: number }>): string | null {
  if (files.length > MAX_FILES_PER_MESSAGE) return `Up to ${MAX_FILES_PER_MESSAGE} files at a time, please.`
  for (const file of files) {
    const problem = fileProblem(file)
    if (problem) return problem
  }
  return null
}

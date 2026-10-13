import { randomBytes } from 'node:crypto'
import type { MediaProviderType } from '@prisma/client'
import { getActiveMediaProvider, isMediaProviderConfigured } from '@/lib/config/env'
import { deleteMedia, downloadMedia, mediaKeyPrefix, uploadMedia } from '@/lib/media/upload'
import { STORAGE_FOLDER } from './constants'
import type { NewAttachment, StoredAttachment } from './db'

// Chat files go into the site's own storage (Backblaze on most sites) under
// this module's private folder, with no media library row. They are only ever
// served through this module's attachment route, which checks who is asking.
// The key carries a random id nobody outside the database has seen, because
// the media Worker will serve any object to whoever knows its key.

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
}

export function typeFor(filename: string, declared: string | null | undefined): string {
  const given = (declared ?? '').split(';')[0]?.trim().toLowerCase()
  if (given && given !== 'application/octet-stream') return given
  const dot = filename.lastIndexOf('.')
  return EXTENSION_TYPES[dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''] ?? 'application/octet-stream'
}

function safeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned.slice(0, 80) || 'attachment'
}

export class StorageUnavailableError extends Error {
  constructor() {
    super('Attachments are not available on this site yet - media storage has not been set up.')
  }
}

/** Writes every file to storage, or none: a failure part way through removes
 *  what was already written and throws. */
export async function storeFiles(conversationId: string, files: File[]): Promise<NewAttachment[]> {
  if (files.length === 0) return []
  const provider = await getActiveMediaProvider()
  if (!provider || !isMediaProviderConfigured(provider)) throw new StorageUnavailableError()

  const stored: NewAttachment[] = []
  try {
    for (const file of files) {
      const id = randomBytes(16).toString('hex')
      const filename = file.name.slice(0, 200) || 'attachment'
      const contentType = typeFor(filename, file.type)
      const key = `${mediaKeyPrefix(provider)}${STORAGE_FOLDER}/${conversationId}/${id}-${safeFilename(filename)}`
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await uploadMedia(buffer, contentType, provider, filename, undefined, false, key)
      stored.push({ id, filename, contentType, sizeBytes: result.sizeBytes || buffer.length, provider, key: result.key, url: result.url })
    }
  } catch (err) {
    await deleteStoredFiles(stored)
    throw err
  }
  return stored
}

export async function loadFile(attachment: StoredAttachment): Promise<Buffer> {
  return downloadMedia(attachment.provider as MediaProviderType, attachment.key, attachment.url)
}

/** Best effort: a file that will not delete is logged, never thrown, so it
 *  cannot keep a conversation alive that somebody asked to be rid of. */
export async function deleteStoredFiles(files: Array<{ provider: string; key: string }>): Promise<void> {
  for (const f of files) {
    await deleteMedia(f.provider as MediaProviderType, f.key).catch((err) =>
      console.error('[chat] could not delete a stored attachment', f.key, err),
    )
  }
}

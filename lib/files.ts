// What may be attached, read from both the browser and the server so they give
// the same answer. Executables are refused because these bytes sit in the same
// storage the site serves its pictures from, and markup is refused because a
// page of it opened later is a script running on that origin.
export { MAX_ATTACHMENT_BYTES, MAX_FILES_PER_MESSAGE } from './constants'

export const BLOCKED_EXTENSION_LIST: readonly string[] = [
  'exe', 'com', 'bat', 'cmd', 'msi', 'scr', 'pif', 'cpl', 'dll', 'reg', 'lnk', 'hta', 'jar', 'app', 'dmg', 'pkg',
  'apk', 'iso', 'js', 'mjs', 'cjs', 'vbs', 'wsf', 'ps1', 'sh', 'py', 'rb', 'php', 'pl',
  'htm', 'html', 'xhtml', 'shtml', 'svg', 'xml',
]

/** Types a browser may be allowed to show in place rather than download. */
export function isInlineImage(contentType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|heic)$/i.test(contentType)
}

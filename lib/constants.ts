// Shared by the server and the browser, so nothing in here may import anything
// with a runtime cost.

export const MODULE_NAME = 'chat'
export const API_BASE = `/api/m/${MODULE_NAME}`

/** The manifest id of this module's `core.conversation-provider` entry. */
export const PROVIDER_ID = 'chat'

export const PERM_VIEW = 'chat.view'
export const PERM_REPLY = 'chat.reply'
export const PERM_MANAGE = 'chat.manage'

/** The private storage folder attachments are kept under (no library row). */
export const STORAGE_FOLDER = 'chat'

/** One file. Kept under the host's 4.5MB request ceiling, because attachments
 *  travel through the site's own request rather than straight to storage. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_FILES_PER_MESSAGE = 3
export const MAX_MESSAGE_CHARS = 4000

/** Where the visitor's browser keeps its claim on a chat. */
export const VISITOR_STORAGE_KEY = 'cactus-chat'

/** The header a visitor's browser proves it owns a chat with. */
export const VISITOR_HEADER = 'x-chat-visitor'

/** Fired on window to open the chat from anywhere on the page. */
export const CHAT_OPEN_EVENT = 'cactus:chat-open'

export const FILE_ACCEPT = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'

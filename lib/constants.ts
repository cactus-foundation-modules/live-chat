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

/** The cookie banner category this module asks visitors to agree to. The same
 *  key the Chatwoot-powered live chat declares, so a site moving from one to the
 *  other keeps the answers its visitors already gave. */
export const CONSENT_CATEGORY = 'live-chat'

/** The header a visitor's browser proves it owns its visitor row with. */
export const PRESENCE_HEADER = 'x-chat-presence'

/** How recently a visitor must have checked in to count as on the site now.
 *  The widget checks in every 30 seconds while the tab is in front. */
export const ONLINE_WINDOW_SECONDS = 90

/** How often the widget checks in while the tab is in front. */
export const PRESENCE_EVERY_MS = 30_000

/** A visitor's trail is deleted this long after they were last seen. */
export const VISITOR_RETENTION_DAYS = 7

/** How many pages of a visitor's trail are kept. */
export const MAX_TRAIL = 30

/** Where the shop keeps a visitor's basket in their browser, and the event it
 *  fires when the basket changes. Read only, and only when it is there: the
 *  chat does not need the shop, it just shows the basket when there is one. */
export const SHOP_CART_STORAGE_KEY = 'cactus_shop_cart'
export const SHOP_CART_EVENT = 'cactus-shop-cart-changed'

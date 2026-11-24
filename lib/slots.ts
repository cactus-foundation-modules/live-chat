import type { ComponentType } from 'react'
import type { ChatProduct } from './product-links'

// Places in Live chat's own screens where another module may put a small
// component of its own. Plain types and names only, so the browser can import
// this file; the server picks the components (lib/slots.server.ts) and hands
// them down as props.
//
// A provider publishes a client component (a 'use client' file, outside
// components/admin/ so it also reaches the bubble on the public site) at one of
// these points. One component per slot: the first registered wins, in manifest
// order. Nothing registered, nothing drawn - the screens are exactly as they
// were. A slot component that throws while drawing is dropped quietly rather
// than taking the chat down with it.

/** Beside the Online switch, in the admin chat window and the bubble a signed-in
 *  colleague sees on the site. */
export const ADMIN_TOOLBAR_POINT = 'chat.admin-toolbar'
export type ChatAdminToolbarProps = { surface: 'inbox' | 'bubble' }

/** In the header of the chat on screen, in the admin chat window and the bubble. */
export const CONVERSATION_ACTIONS_POINT = 'chat.conversation-actions'
export type ChatConversationActionsProps = { conversationId: string; status: 'open' | 'closed' }

/** Under a message drawn with product cards, in the visitor's chat window only.
 *  Each product carries `basket` (the shop's own ids) when the shop could say. */
export const PRODUCT_ACTIONS_POINT = 'chat.product-actions'
export type ChatProductActionsProps = { products: ChatProduct[] }

/** The components the server found, as handed to Live chat's client screens. */
export type ChatSlots = {
  adminToolbar: ComponentType<ChatAdminToolbarProps> | null
  conversationActions: ComponentType<ChatConversationActionsProps> | null
  productActions: ComponentType<ChatProductActionsProps> | null
}

export const NO_SLOTS: ChatSlots = { adminToolbar: null, conversationActions: null, productActions: null }

import type { ComponentType } from 'react'
import {
  ADMIN_TOOLBAR_POINT,
  CONVERSATION_ACTIONS_POINT,
  NO_SLOTS,
  PRODUCT_ACTIONS_POINT,
  type ChatAdminToolbarProps,
  type ChatConversationActionsProps,
  type ChatProductActionsProps,
  type ChatSlots,
} from './slots'

// Picks the components other modules put in Live chat's slots (lib/slots.ts),
// on the server, so that the generated registry - which imports every module's
// extension code, Prisma-backed resolvers included - never reaches a browser
// bundle. The same shape as the shop's checkout address lookup
// (modules/shop/lib/checkout-address-lookup.ts), except reached through a
// dynamic import so no static edge back into the registry can close a cycle.
//
// SERVER ONLY: call from a server component and pass the result down as props.

// React marks a component from a 'use client' file, as seen by a server
// component, with this. Only such a component can be handed to a client
// component as a prop; anything else would fail the whole render, so it is
// ignored instead.
const CLIENT_REFERENCE = Symbol.for('react.client.reference')

function isClientComponent(value: unknown): boolean {
  if (typeof value !== 'function' && (typeof value !== 'object' || value === null)) return false
  return (value as { $$typeof?: unknown }).$$typeof === CLIENT_REFERENCE
}

function first(entries: Record<string, unknown> | undefined): unknown {
  for (const value of Object.values(entries ?? {})) {
    if (isClientComponent(value)) return value
  }
  return null
}

/** The first client component registered at each slot, or null. Never throws:
 *  a registry that cannot be read leaves every slot empty. */
export async function resolveChatSlots(): Promise<ChatSlots> {
  try {
    const { modulePublicExtensionPointComponents } = await import('@/lib/modules/extension-points.public')
    return {
      adminToolbar: first(modulePublicExtensionPointComponents[ADMIN_TOOLBAR_POINT]) as ComponentType<ChatAdminToolbarProps> | null,
      conversationActions: first(modulePublicExtensionPointComponents[CONVERSATION_ACTIONS_POINT]) as ComponentType<ChatConversationActionsProps> | null,
      productActions: first(modulePublicExtensionPointComponents[PRODUCT_ACTIONS_POINT]) as ComponentType<ChatProductActionsProps> | null,
    }
  } catch (err) {
    console.error('[chat] could not read the components other modules add to the chat', err)
    return NO_SLOTS
  }
}

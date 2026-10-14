'use client'

import { useEffect } from 'react'

// Keeps the chat out of the shop's slide-out basket's way. Beside a side panel
// the dock slides along by the panel's width; under a slide-up panel it rises by
// the panel's height; a side panel as wide as the screen (a phone) leaves
// nowhere to go, so the dock gives way until the basket shuts. The shop
// announces open and shut on a window event and marks <html>; the names are
// declared here rather than imported because this module must build on a site
// with no shop (see the contract in shop's cart-drawer-extras.ts). Measured from
// layout sizes (offsetWidth/Height), which ignore the panel's slide-in transform.
// The result is a data attribute and two variables on <html> that ChatStyles
// turns into a transform.
const STATE_EVENT = 'cactus-shop:cart-drawer'
const OPEN_ATTRIBUTE = 'data-cactus-cart-drawer'

export function useCartDrawerDodge(position: 'left' | 'right'): void {
  useEffect(() => {
    const root = document.documentElement
    let observer: ResizeObserver | null = null
    let frame = 0

    const clear = () => {
      root.removeAttribute('data-cch-cart')
      root.style.removeProperty('--cch-cart-x')
      root.style.removeProperty('--cch-cart-y')
    }
    const apply = (panel: HTMLElement) => {
      const w = panel.offsetWidth
      const h = panel.offsetHeight
      if (panel.classList.contains('scd-bottom')) {
        root.setAttribute('data-cch-cart', 'bottom')
        root.style.setProperty('--cch-cart-x', '0px')
        root.style.setProperty('--cch-cart-y', `${h}px`)
      } else if (w >= window.innerWidth - 8) {
        root.setAttribute('data-cch-cart', 'full')
      } else {
        const panelSide = panel.classList.contains('scd-left') ? 'left' : 'right'
        const x = panelSide !== position ? 0 : position === 'right' ? -w : w
        root.setAttribute('data-cch-cart', 'side')
        root.style.setProperty('--cch-cart-x', `${x}px`)
        root.style.setProperty('--cch-cart-y', '0px')
      }
    }
    const livePanel = () => document.querySelector<HTMLElement>('.scd-panel.scd-in')
    // The panel mounts on the first open, a beat after the open is announced.
    const find = (tries: number) => {
      const panel = livePanel()
      if (!panel) { if (tries > 0) frame = requestAnimationFrame(() => find(tries - 1)); return }
      apply(panel)
      observer = new ResizeObserver(() => apply(panel))
      observer.observe(panel)
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      observer = null
      if (root.getAttribute(OPEN_ATTRIBUTE) === 'open') find(30)
      else clear()
    }
    const onResize = () => { const panel = livePanel(); if (panel && root.getAttribute(OPEN_ATTRIBUTE) === 'open') apply(panel) }

    sync()
    window.addEventListener(STATE_EVENT, sync)
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener(STATE_EVENT, sync)
      window.removeEventListener('resize', onResize)
      clear()
    }
  }, [position])
}

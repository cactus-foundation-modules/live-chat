// The service worker that shows a visitor's chat notifications when the tab is
// closed. Served by the widget/sw route, so its scope is that route's folder
// and it takes over no page of the site: a worker only has to exist to receive
// a push. Plain JavaScript, run by the browser exactly as written.
export const CHAT_WORKER_SOURCE = `'use strict'
self.addEventListener('install', function () { self.skipWaiting() })
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()) })

function localPath(value) {
  return typeof value === 'string' && value.charAt(0) === '/' && value.charAt(1) !== '/' && value.charAt(1) !== '\\\\'
}

self.addEventListener('push', function (event) {
  var data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  var title = typeof data.title === 'string' && data.title ? data.title : 'New message'
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' ? data.tag : 'chat',
    renotify: true,
    data: { href: localPath(data.href) ? data.href : '/' }
  }))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var href = event.notification.data && localPath(event.notification.data.href) ? event.notification.data.href : '/'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
    for (var i = 0; i < windows.length; i++) {
      if (new URL(windows[i].url).origin === self.location.origin && 'focus' in windows[i]) {
        windows[i].postMessage({ type: 'cactus-chat-open' })
        return windows[i].focus()
      }
    }
    return self.clients.openWindow(href)
  }))
})
`

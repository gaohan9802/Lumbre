const STATIC_CACHE = 'lumbre-static-v2'
const STATIC_RE = /\/_next\/static\/|\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico)(?:\?.*)?$/i

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !STATIC_RE.test(url.pathname)) return
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE)
    const cached = await cache.match(event.request)
    const network = fetch(event.request).then(response => {
      if (response.ok) cache.put(event.request, response.clone())
      return response
    }).catch(() => cached)
    return cached || network
  })())
})
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  event.waitUntil(self.registration.showNotification(data.title || '星星醒了', {
    body: data.body || '', icon: '/logo-pwa.jpg', badge: '/favicon.png', tag: data.tag || 'lumbre-star', renotify: true,
    data: { url: data.url || '/' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => 'focus' in client)
    return existing ? existing.focus() : clients.openWindow(url)
  }))
})

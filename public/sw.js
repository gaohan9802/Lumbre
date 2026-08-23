const STATIC_CACHE = 'lumbre-static-v3'
const STATIC_RE = /\/_next\/static\/|\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico)(?:\?.*)?$/i

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  const isNextAsset = url.pathname.startsWith('/_next/static/')
  const isStatic = isNextAsset || /\.(?:woff2?|png|jpg|jpeg|svg|ico)(?:\?.*)?$/i.test(url.pathname)
  const isNavigation = request.mode === 'navigate'
  if (!isStatic && !isNavigation) return

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE)
    // Never serve an old Next chunk first: mixed build manifests are a common
    // cause of a blank React/PWA screen after deployment. Network-first keeps
    // code coherent; cache is only the offline fallback.
    if (isNextAsset || isNavigation) {
      try {
        const response = await fetch(request)
        if (response.ok && isStatic) await cache.put(request, response.clone())
        return response
      } catch {
        return (await cache.match(request)) || Response.error()
      }
    }
    const cached = await cache.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    } catch { return Response.error() }
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

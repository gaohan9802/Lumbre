const STATIC_CACHE = 'lumbre-static-v4'
const APP_SHELL_KEY = new URL('/__lumbre_app_shell__', self.location.origin).toString()

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  // Keep old hashed chunks as an offline companion to an older cached shell.
  // Their URLs are content-addressed, so they cannot shadow a newer build.
  event.waitUntil(self.clients.claim())
})

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(request, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function offlinePage() {
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumbre</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#171412;color:#f5eee7;font:15px system-ui;text-align:center}.card{padding:28px}.dot{font-size:36px;margin-bottom:12px}</style><div class="card"><div class="dot">🐆</div><div>暂时无法连接 Lumbre</div><p>网络恢复后重新打开即可，待发消息不会丢失。</p></div></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  const isNextAsset = url.pathname.startsWith('/_next/static/')
  const isStaticAsset = /\.(?:woff2?|png|jpg|jpeg|webp|gif|svg|ico)$/i.test(url.pathname)
  const isNavigation = request.mode === 'navigate'
  if (!isNextAsset && !isStaticAsset && !isNavigation) return

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE)

    // Next build assets have content hashes. Cache-first avoids waiting for a
    // weak mobile connection and cannot mix different code at the same URL.
    if (isNextAsset || isStaticAsset) {
      const cached = await caches.match(request)
      if (cached) return cached
      try {
        const response = await fetch(request)
        if (response.ok) await cache.put(request, response.clone())
        return response
      } catch {
        return new Response('', { status: 503, statusText: 'Offline' })
      }
    }

    // Prefer fresh HTML, but never leave iOS on a white Response.error page.
    try {
      const response = await fetchWithTimeout(request, 8000)
      const finalUrl = new URL(response.url)
      const contentType = response.headers.get('content-type') || ''
      if (response.ok && url.pathname === '/' && finalUrl.pathname === '/' && contentType.includes('text/html')) {
        await cache.put(APP_SHELL_KEY, response.clone())
      }
      return response
    } catch {
      return (await caches.match(APP_SHELL_KEY)) || offlinePage()
    }
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

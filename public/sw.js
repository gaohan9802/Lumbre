self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  event.waitUntil(self.registration.showNotification(data.title || '星星醒了', {
    body: data.body || '',
    icon: '/logo-pwa.jpg',
    badge: '/favicon.png',
    tag: data.tag || 'lumbre-star',
    renotify: true,
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

/** iOS/desktop Web Push storage and delivery. Persistent under /persistent/push. */
import webpush from 'web-push'
import { getOrCreateVapidKeys, readPushSubscriptionData, updatePushSubscriptionData } from './data/repositories/push'

export interface StoredPushSubscription {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
  createdAt?: number
  userAgent?: string
}

function validSubscription(value: unknown): value is StoredPushSubscription {
  if (!value || typeof value !== 'object') return false
  const subscription = value as StoredPushSubscription
  return typeof subscription.endpoint === 'string'
    && !!subscription.endpoint
    && !!subscription.keys
    && typeof subscription.keys.p256dh === 'string'
    && !!subscription.keys.p256dh
    && typeof subscription.keys.auth === 'string'
    && !!subscription.keys.auth
}

function normalizeSubscriptions(value: unknown[]): StoredPushSubscription[] {
  return value.filter(validSubscription)
}

function getVapidKeys() {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim()
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim()
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate }
  return getOrCreateVapidKeys(() => webpush.generateVAPIDKeys())
}

function configure() {
  const keys = getVapidKeys()
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:gris.sidereal@gmail.com', keys.publicKey, keys.privateKey)
  return keys
}

export function getVapidPublicKey() { return configure().publicKey }

export function listPushSubscriptions(): StoredPushSubscription[] {
  return normalizeSubscriptions(readPushSubscriptionData())
}

export function savePushSubscription(subscription: StoredPushSubscription) {
  let next: StoredPushSubscription[] = []
  updatePushSubscriptionData(raw => {
    next = normalizeSubscriptions(raw).filter(value => value.endpoint !== subscription.endpoint)
    next.push({ ...subscription, createdAt: Date.now() })
    return next
  })
  return next.length
}

export function removePushSubscription(endpoint: string) {
  let next: StoredPushSubscription[] = []
  updatePushSubscriptionData(raw => {
    next = normalizeSubscriptions(raw).filter(subscription => subscription.endpoint !== endpoint)
    return next
  })
  return next.length
}

export async function sendPushMessages(messages: string[], title = '星星醒了') {
  configure()
  const clean = messages.map((m) => String(m || '').trim()).filter(Boolean).slice(0, 8)
  if (!clean.length) return { sent: 0, failed: 0, subscriptions: listPushSubscriptions().length }
  let subscriptions = listPushSubscriptions()
  let sent = 0
  let failed = 0
  const errors: string[] = []
  const dead = new Set<string>()
  for (const message of clean) {
    const payload = JSON.stringify({ title, body: message.slice(0, 180), url: '/', tag: `star-wake-${Date.now()}-${sent}` })
    const results = await Promise.allSettled(subscriptions.map((subscription) => webpush.sendNotification(subscription as any, payload, { TTL: 3600 })))
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') sent++
      else {
        failed++
        const reason: any = result.reason
        errors.push(String(reason?.statusCode || reason?.message || reason || 'push failed').slice(0, 300))
        const status = Number(reason?.statusCode || 0)
        if (status === 404 || status === 410) dead.add(subscriptions[index].endpoint)
      }
    })
  }
  if (dead.size) {
    updatePushSubscriptionData(raw => {
      subscriptions = normalizeSubscriptions(raw).filter(subscription => !dead.has(subscription.endpoint))
      return subscriptions
    })
  }
  return { sent, failed, subscriptions: subscriptions.length, errors: Array.from(new Set(errors)).slice(0, 8) }
}

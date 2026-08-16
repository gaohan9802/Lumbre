/** iOS/desktop Web Push storage and delivery. Persistent under /persistent/push. */
import fs from 'fs'
import path from 'path'
import webpush from 'web-push'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const DIR = path.join(DATA_DIR, 'push')
const SUBS_FILE = path.join(DIR, 'subscriptions.json')
const VAPID_FILE = path.join(DIR, 'vapid.json')

export interface StoredPushSubscription {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
  createdAt?: number
  userAgent?: string
}

function ensureDir() { fs.mkdirSync(DIR, { recursive: true }) }
function atomicWrite(file: string, data: unknown) {
  ensureDir()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

function getVapidKeys() {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim()
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim()
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate }
  ensureDir()
  try {
    const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'))
    if (saved.publicKey && saved.privateKey) return saved
  } catch {}
  const generated = webpush.generateVAPIDKeys()
  atomicWrite(VAPID_FILE, generated)
  return generated
}

function configure() {
  const keys = getVapidKeys()
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:gris.sidereal@gmail.com', keys.publicKey, keys.privateKey)
  return keys
}

export function getVapidPublicKey() { return configure().publicKey }

export function listPushSubscriptions(): StoredPushSubscription[] {
  ensureDir()
  try {
    const raw = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8'))
    return Array.isArray(raw) ? raw.filter((s) => s?.endpoint && s?.keys?.p256dh && s?.keys?.auth) : []
  } catch { return [] }
}

export function savePushSubscription(subscription: StoredPushSubscription) {
  const subscriptions = listPushSubscriptions()
  const next = subscriptions.filter((s) => s.endpoint !== subscription.endpoint)
  next.push({ ...subscription, createdAt: Date.now() })
  atomicWrite(SUBS_FILE, next)
  return next.length
}

export function removePushSubscription(endpoint: string) {
  const next = listPushSubscriptions().filter((s) => s.endpoint !== endpoint)
  atomicWrite(SUBS_FILE, next)
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
    subscriptions = subscriptions.filter((s) => !dead.has(s.endpoint))
    atomicWrite(SUBS_FILE, subscriptions)
  }
  return { sent, failed, subscriptions: subscriptions.length, errors: Array.from(new Set(errors)).slice(0, 8) }
}

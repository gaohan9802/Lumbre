import { getDataDir } from '../config'
import { DataCorruptionError, DataFileNotFoundError } from '../errors'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'

export interface StoredVapidKeys {
  publicKey: string
  privateKey: string
}

const PUSH_DIR = resolveDataPath(getDataDir(), 'push')
const SUBSCRIPTIONS_FILE = resolveDataPath(PUSH_DIR, 'subscriptions.json')
const VAPID_FILE = resolveDataPath(PUSH_DIR, 'vapid.json')

function validVapidKeys(value: unknown): value is StoredVapidKeys {
  return !!value
    && typeof value === 'object'
    && typeof (value as StoredVapidKeys).publicKey === 'string'
    && !!(value as StoredVapidKeys).publicKey
    && typeof (value as StoredVapidKeys).privateKey === 'string'
    && !!(value as StoredVapidKeys).privateKey
}

function validSubscriptions(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

export function getOrCreateVapidKeys(generate: () => StoredVapidKeys): StoredVapidKeys {
  try {
    return readJsonFile(VAPID_FILE, { validate: validVapidKeys })
  } catch (error) {
    if (!(error instanceof DataFileNotFoundError) && !(error instanceof DataCorruptionError)) throw error
  }
  return updateJsonFile(VAPID_FILE, {
    fallback: generate,
    fallbackOnInvalid: true,
    validate: validVapidKeys,
  }, current => current)
}

export function readPushSubscriptionData(): unknown[] {
  return readJsonFile(SUBSCRIPTIONS_FILE, {
    fallback: () => [],
    fallbackOnInvalid: true,
    validate: validSubscriptions,
  })
}

export function updatePushSubscriptionData(update: (current: unknown[]) => unknown[]): unknown[] {
  return updateJsonFile(SUBSCRIPTIONS_FILE, {
    fallback: () => [],
    fallbackOnInvalid: true,
    validate: validSubscriptions,
  }, update)
}

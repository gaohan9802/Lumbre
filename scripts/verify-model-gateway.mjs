import fs from 'node:fs'
import path from 'node:path'

const dataDir = path.resolve(process.env.DATA_DIR || '/persistent')
const manifestPath = path.join(dataDir, 'chat', 'manifest.json')
const credentialPath = path.join(dataDir, 'model-gateway', 'credentials.json')

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function countForbiddenKeys(value) {
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.reduce((total, item) => total + countForbiddenKeys(item), 0)
  return Object.entries(value).reduce((total, [key, item]) => {
    const forbidden = /^(apiKey|api_key|baseUrl)$/i.test(key) ? 1 : 0
    return total + forbidden + countForbiddenKeys(item)
  }, 0)
}

const manifest = readJson(manifestPath)
const credentials = readJson(credentialPath)
const profiles = Array.isArray(credentials?.profiles) ? credentials.profiles : []
const forbiddenSyncFields = countForbiddenKeys(manifest?.config)
const plaintextCredentialFields = profiles.filter(profile => Object.prototype.hasOwnProperty.call(profile || {}, 'apiKey')).length
const encryptedRecords = profiles.filter(profile => typeof profile?.encryptedApiKey === 'string' && profile.encryptedApiKey.split('.').length === 3).length

console.log(`MODEL_GATEWAY_DATA_DIR ${dataDir}`)
console.log(`MODEL_GATEWAY_SYNC_FORBIDDEN_FIELDS ${forbiddenSyncFields}`)
console.log(`MODEL_GATEWAY_CREDENTIAL_RECORDS ${profiles.length}`)
console.log(`MODEL_GATEWAY_ENCRYPTED_RECORDS ${encryptedRecords}`)
console.log(`MODEL_GATEWAY_PLAINTEXT_FIELDS ${plaintextCredentialFields}`)

if (!manifest) console.error('MODEL_GATEWAY_WARNING chat manifest not found or unreadable')
if (forbiddenSyncFields || plaintextCredentialFields || encryptedRecords !== profiles.length) process.exitCode = 1

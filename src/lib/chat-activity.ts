export function lastUserMessageAt(session: {
  lastUserMessageAt?: number
  createdAt?: number
  messages?: Array<{ role?: string; timestamp?: number }>
}) {
  let latest = Math.max(0, Number(session.lastUserMessageAt) || 0)
  for (const message of session.messages || []) {
    if (message.role === 'user') latest = Math.max(latest, Number(message.timestamp) || 0)
  }
  return latest || Math.max(0, Number(session.createdAt) || 0)
}

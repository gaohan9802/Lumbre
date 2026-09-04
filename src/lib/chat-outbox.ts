// Compatibility facade for older imports. New chat code owns the outbox under
// the feature boundary so offline recovery is no longer mixed with app globals.
export { flushChatOutbox, queueChatAppend } from '@/features/chat/sync/outbox'

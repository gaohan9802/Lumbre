import { createTransportBatchId, persistTransportPart, runTransportTurn, type TransportTurnPart } from '@/server/chat/transport-turn'

export type WeChatTurnPart = TransportTurnPart

export function createWeChatBatchId(externalId: string) {
  return createTransportBatchId('wechat', externalId)
}

export function persistWeChatPart(sessionId: string, batchId: string, part: WeChatTurnPart) {
  return persistTransportPart('wechat', sessionId, batchId, part)
}

export function runWeChatTurn(sessionId: string, batchId: string, parts: WeChatTurnPart[]) {
  return runTransportTurn('wechat', sessionId, batchId, parts)
}

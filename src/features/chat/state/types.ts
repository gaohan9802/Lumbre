import type { ReplyMode } from '@/lib/chat-reply-mode'
import type { ChatRoute } from '@/lib/chat-route'
import type { SharedCard } from '@/lib/share'
import type { MessageRequestAudit } from '@/lib/chat-receipt'

export interface ContentBlock {
  type: 'thinking' | 'text' | 'tool_call'
  content?: string
  name?: string
  input?: Record<string, any>
  result?: string
}

export interface BubbleSegment {
  blockIndex: number
  start: number
  end: number
  kind: 'text' | 'code' | 'list' | 'quote' | 'table'
}

export interface BubbleLayout {
  version: 2
  segments: BubbleSegment[]
}

export interface MessageVersion {
  route?: ChatRoute
  ccAttemptId?: string
  ccSessionFingerprint?: string
  ccSessionMode?: 'bootstrap' | 'resume' | 'rebase'
  ccSessionReason?: string
  ccCompacted?: boolean
  ccGenerationState?: 'pending' | 'settled'
  replyMode?: ReplyMode
  bubbleLayout?: BubbleLayout
  content: string
  thinking?: string
  timestamp: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
  request_audit?: MessageRequestAudit
  tool_calls?: { name: string; input: Record<string, any>; result: string }[]
  content_blocks?: ContentBlock[]
  sharedCard?: SharedCard
  providerId?: string
  modelId?: string
}

export interface ChatMessage extends MessageVersion {
  id: string
  role: 'user' | 'assistant'
  images?: string[]
  sharedCard?: SharedCard
  versions?: MessageVersion[]
  versionIndex?: number
}

export type ApiProvider = 'anthropic' | 'openai-compatible'

export interface ProviderModel {
  id: string
  name?: string
  ownedBy?: string
  created?: number
  enabled: boolean
  inputPrice?: number
  outputPrice?: number
  cachePrice?: number
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  defaultModel: string
  models: ProviderModel[]
  lastFetchedAt?: number
  credentialConfigured?: boolean
  upstreamOrigin?: string
}

export interface ChatSummary {
  id: string
  sessionId: string
  startAt: number
  endAt: number
  createdAt: number
  turnCount: number
  messageCount?: number
  sourceMessageIds?: string[]
  coveredUntilMessageId: string
  eventSummary: string
  locked?: boolean
  needsCorrection?: boolean
  editedAt?: number
}

export interface StageSummary {
  id: string
  sessionId: string
  createdAt: number
  startAt: number
  endAt: number
  sourceSummaryIds: string[]
  title: string
  content: string
}

export interface SessionSummaryConfig {
  autoEnabled: boolean
  turnSize: 20 | 30 | 40
  injectCount: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  profileId?: string
  modelId?: string
  modeVersion?: 2
  anchorMessageId?: string
  anchorTimestamp?: number
}

export interface ChatSession {
  generationRoute?: ChatRoute
  generationRouteUpdatedAt?: number
  conversationMode?: ReplyMode
  conversationModeUpdatedAt?: number
  id: string
  title: string
  messages: ChatMessage[]
  pinned: boolean
  createdAt: number
  updatedAt: number
  partial?: boolean
  messageCount?: number
  summaries?: ChatSummary[]
  stageSummaries?: StageSummary[]
  summaryRevision?: number
  summaryConfig?: SessionSummaryConfig
}

export interface ChatAppearance {
  userBubbleFrosted?: boolean
  userBubbleBlur?: number
  userBubbleFrostedNight?: boolean
  userBubbleBlurNight?: number
  aiBubbleFrosted?: boolean
  aiBubbleBlur?: number
  aiBubbleFrostedNight?: boolean
  aiBubbleBlurNight?: number

  bgImage: string
  bgOpacity: number
  userBubbleColor: string
  userBubbleOpacity: number
  aiBubbleColor: string
  aiBubbleOpacity: number
  userBubbleColorNight: string
  userBubbleOpacityNight: number
  aiBubbleColorNight: string
  aiBubbleOpacityNight: number
}

export interface Bookmark {
  id: string
  name: string
  keywords: string[]
  content: string
  position: 'start' | 'end'
  scanDepth: number
  priority: number
  alwaysOn: boolean
  enabled: boolean
}

export interface ChatSettings {
  systemPrompt: string
  contextLength: number
  model: string
  thinkingBudget: number
  temperature: number
  streamEnabled: boolean
  promptCaching: boolean
  appearance: ChatAppearance
  activeProfileId: string
  apiProfiles: ApiProfile[]
  activeSessionId: string
  sessions: ChatSession[]
  tombstones: Record<string, number>
  starStatus?: { text: string; timestamp: number; msgCount?: number }
  bookmarks: Bookmark[]
  summaryTurnSize: 20 | 30 | 40
  summaryInjectCount: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  configUpdatedAt: number
}

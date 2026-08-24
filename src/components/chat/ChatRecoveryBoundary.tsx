'use client'

import React from 'react'
import { ChatView, ChatViewProps } from './ChatView'

interface State {
  error: Error | null
  resetKey: number
  autoRetried: boolean
}

/**
 * Keep a malformed legacy message or a transient WebKit render failure from
 * replacing the entire Chat screen with a permanent white page. This boundary
 * only remounts ChatView; it never clears the Zustand store or local drafts.
 */
export class ChatRecoveryBoundary extends React.Component<ChatViewProps, State> {
  state: State = { error: null, resetKey: 0, autoRetried: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Chat render recovered', error, info.componentStack)
    if (!this.state.autoRetried) {
      window.setTimeout(() => this.setState((state) => ({
        error: null,
        resetKey: state.resetKey + 1,
        autoRetried: true,
      })), 120)
    }
  }

  private retry = () => this.setState((state) => ({
    error: null,
    resetKey: state.resetKey + 1,
    autoRetried: true,
  }))

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center px-6 text-center">
          <div className="max-w-sm space-y-3">
            <div className="text-2xl">⭐</div>
            <p className="text-sm font-medium">聊天显示刚刚卡住了</p>
            <p className="text-xs opacity-55">聊天内容仍在本地和服务器中，不会被清空。</p>
            <button onClick={this.retry} className="rounded-xl bg-day-pink px-4 py-2 text-xs text-white">
              立即恢复聊天
            </button>
          </div>
        </div>
      )
    }
    return <ChatView key={this.state.resetKey} {...this.props} />
  }
}

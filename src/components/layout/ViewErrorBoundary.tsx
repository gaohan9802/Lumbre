'use client'

import React from 'react'

export class ViewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; retryKey: number }
> {
  state = { error: null as Error | null, retryKey: 0 }

  static getDerivedStateFromError(error: Error) {
    return { error, retryKey: 0 }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[lumbre view crashed]', error, info)
  }

  private recover = () => {
    this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }))
    window.dispatchEvent(new Event('lumbre:sync-retry'))
  }

  render() {
    if (!this.state.error) return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <div className="text-lg">页面暂时没醒过来</div>
          <div className="text-sm opacity-60">数据仍保存在本地和服务器上，可以安全重试。</div>
          <button onClick={() => { this.recover(); setTimeout(() => window.location.reload(), 80) }} className="rounded-xl px-4 py-2 text-sm bg-black/10 dark:bg-white/10">
            重新打开
          </button>
        </div>
      </div>
    )
  }
}

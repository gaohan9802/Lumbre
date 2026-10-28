export interface BatchClock {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

const realClock: BatchClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: timer => clearTimeout(timer),
}

/** Collects consecutive messages until the sender has been quiet for a moment. */
export class WeChatBatcher<T> {
  private items: T[] = []
  private silenceTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly onFlush: (items: T[]) => void | Promise<void>,
    private readonly silenceMs = 10_000,
    private readonly clock: BatchClock = realClock,
  ) {}

  peek(): T | undefined { return this.items[0] }
  get size() { return this.items.length }

  add(item: T) {
    this.items.push(item)
    if (this.silenceTimer) this.clock.clearTimeout(this.silenceTimer)
    this.silenceTimer = this.clock.setTimeout(() => void this.flush(), this.silenceMs)
  }

  async flush() {
    if (!this.items.length) return
    const items = this.items
    this.items = []
    if (this.silenceTimer) this.clock.clearTimeout(this.silenceTimer)
    this.silenceTimer = undefined
    await this.onFlush(items)
  }

  clear() {
    this.items = []
    if (this.silenceTimer) this.clock.clearTimeout(this.silenceTimer)
    this.silenceTimer = undefined
  }
}

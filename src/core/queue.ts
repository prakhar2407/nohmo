import type { NohmoEvent } from './types'

export class EventQueue {
  private queue: NohmoEvent[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private flushFn: (events: NohmoEvent[]) => void
  private interval: number

  constructor(
    flushFn: (events: NohmoEvent[]) => void,
    interval: number = 3000
  ) {
    this.flushFn = flushFn
    this.interval = interval
  }

  start() {
    this.timer = setInterval(() => this.flush(), this.interval)

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flush()
      })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flush())
      window.addEventListener('beforeunload', () => this.flush())
    }
  }

  push(event: NohmoEvent) {
    this.queue.push(event)
  }

  flush() {
    if (!this.queue.length) return
    const batch = [...this.queue]
    this.queue = []
    this.flushFn(batch)
  }

  destroy() {
    if (this.timer) clearInterval(this.timer)
    this.flush()
  }
}

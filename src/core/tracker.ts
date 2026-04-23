import { AutoCapture } from './autocapture'
import { getDeviceId } from './fingerprint'
import { EventQueue } from './queue'
import type { NohmoConfig, NohmoEvent, NohmoState } from './types'

export class NohmoTracker {
  private config: Required<NohmoConfig>
  private state: NohmoState
  private queue: EventQueue
  private pageStart: number = Date.now()
  private autoCapture: AutoCapture | null = null

  constructor(config: NohmoConfig) {
    this.config = {
      flushInterval: 3000,
      debug: false,
      autoPageView: true,
      autoScrollDepth: true,
      autoTimeSpent: true,
      autoCapture: true,
      ...config,
    }

    this.state = {
      deviceId: null,
      userId: null,
      sessionId: this.generateSessionId(),
      ready: false,
    }

    this.queue = new EventQueue(
      (events) => this.sendBatch(events),
      this.config.flushInterval
    )
  }

  async init(): Promise<void> {
    if (typeof window === 'undefined') return

    try {
      const deviceId = await getDeviceId()
      this.state.deviceId = deviceId

      const res = await fetch(
        `${this.config.apiUrl}/api/tracker/identify/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey,
          },
          body: JSON.stringify({ deviceId }),
        }
      )

      const data = await res.json() as { userId?: string }
      this.state.userId = data.userId ?? null
      this.state.ready = true

      this.queue.start()

      if (this.config.autoCapture) {
        this.autoCapture = new AutoCapture(this)
        this.autoCapture.start()
      }

      this.log('Nohmo initialized', this.state)
    } catch (err) {
      console.error('[Nohmo] Failed to initialize:', err)
    }
  }

  send(event: string, data: Record<string, unknown> = {}) {
    if (!this.state.ready) {
      this.log('Not ready, dropping event:', event)
      return
    }

    const payload: NohmoEvent = {
      deviceId: this.state.deviceId!,
      userId: this.state.userId,
      sessionId: this.state.sessionId,
      event,
      data,
      page: typeof window !== 'undefined' ? window.location.pathname : '',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      ts: Date.now(),
    }

    this.queue.push(payload)
    this.log('Event queued:', payload)
  }

  async linkUser(
    userId: string,
    email?: string,
    meta?: Record<string, unknown>
  ): Promise<void> {
    this.state.userId = userId
    this.queue.flush()

    try {
      await fetch(`${this.config.apiUrl}/api/tracker/link-user/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
        },
        body: JSON.stringify({
          deviceId: this.state.deviceId,
          userId,
          email: email ?? '',
          meta: meta ?? {},
        }),
      })

      this.send('USER_LINKED', { userId, email })
      this.log('User linked:', userId)
    } catch (err) {
      console.error('[Nohmo] Failed to link user:', err)
    }
  }

  trackPageView(path?: string) {
    this.send('PAGE_VIEW', {
      path: path ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
      title: typeof document !== 'undefined' ? document.title : '',
    })
    this.pageStart = Date.now()
  }

  trackTimeSpent(path?: string) {
    const seconds = Math.round((Date.now() - this.pageStart) / 1000)
    if (seconds < 1) return
    this.send('TIME_SPENT', {
      path: path ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
      seconds,
    })
    this.pageStart = Date.now()
  }

  startScrollTracking(): () => void {
    if (typeof window === 'undefined') return () => undefined

    let maxDepth = 0

    const onScroll = () => {
      const scrolled = window.scrollY
      const total = document.body.scrollHeight - window.innerHeight
      if (total <= 0) return

      const depth = Math.round((scrolled / total) * 100)
      const milestone = [25, 50, 75, 100].find(
        (m) => depth >= m && maxDepth < m
      )

      if (milestone !== undefined) {
        maxDepth = milestone
        this.send('SCROLL_DEPTH', {
          depth: milestone,
          page: window.location.pathname,
        })
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }

  private async sendBatch(events: NohmoEvent[]) {
    if (!events.length) return

    const body = JSON.stringify({ events, apiKey: this.config.apiKey })
    const url = `${this.config.apiUrl}/api/tracker/track/`

    try {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      this.log(`Flushed ${events.length} events`)
    } catch {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        })
      } catch (err) {
        console.error('[Nohmo] Failed to flush events:', err)
      }
    }
  }

  private generateSessionId(): string {
    return 'sess_' + Math.random().toString(36).slice(2, 14)
  }

  private log(...args: unknown[]) {
    if (this.config.debug) {
      console.log('[Nohmo]', ...args)
    }
  }

  getState(): NohmoState {
    return { ...this.state }
  }

  destroy() {
    this.autoCapture?.stop()
    this.queue.destroy()
  }
}

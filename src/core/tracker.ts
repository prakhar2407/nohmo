import { AutoCapture } from './autocapture'
import { getDeviceId, getStableId } from './fingerprint'
import { EventQueue } from './queue'
import type { NohmoConfig, NohmoEvent, NohmoState } from './types'

const _b = (s: string) => atob(s)
const _h = _b('aHR0cHM6Ly93d3cubm9obW8uaW4=')
const _p = {
  i: _b('L2FwaS90cmFja2VyL2lkZW50aWZ5Lw=='),
  t: _b('L2FwaS90cmFja2VyL3RyYWNrLw=='),
  l: _b('L2FwaS90cmFja2VyL2xpbmstdXNlci8='),
}

type PartialEvent = Omit<NohmoEvent, 'deviceId'>

export class NohmoTracker {
  private config: Required<NohmoConfig>
  private state: NohmoState
  private queue: EventQueue
  private pageStart: number = Date.now()
  private autoCapture: AutoCapture | null = null
  // Events queued before init() resolves the canonical deviceId
  private pendingEvents: PartialEvent[] = []
  private initResolve: () => void = () => {}
  private readonly initPromise: Promise<void>

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

    this.initPromise = new Promise(resolve => { this.initResolve = resolve })

    this.queue = new EventQueue(
      (events) => this.sendBatch(events),
      this.config.flushInterval
    )
  }

  async init(): Promise<void> {
    if (typeof window === 'undefined') {
      this.initResolve()
      return
    }

    try {
      const [deviceId, stableId] = await Promise.all([getDeviceId(), getStableId()])

      let canonicalId = deviceId
      let userId: string | null = null

      try {
        const res = await fetch(
          `${_h}${_p.i}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': this.config.apiKey,
            },
            body: JSON.stringify({
              deviceId,
              stableId,
              knownUserId: localStorage.getItem('_nohmo_uid') ?? undefined,
            }),
          }
        )

        const json = await res.json() as { success: boolean; data?: { deviceId?: string; userId?: string } }
        const respData = json.data ?? {}
        canonicalId = respData.deviceId ?? deviceId
        userId = respData.userId ?? null

        if (canonicalId !== deviceId) {
          localStorage.setItem('_nohmo_did', canonicalId)
        }
      } catch {
        // Identify failed — fall back to local deviceId. Events will be stored
        // once the device is created on the next successful identify.
      }

      this.state.deviceId = canonicalId
      this.state.userId = userId
      this.state.ready = true

      // Drain events that were sent before init completed
      for (const e of this.pendingEvents) {
        this.queue.push({ ...e, deviceId: canonicalId })
      }
      this.pendingEvents = []

      this.queue.start()
      this.initResolve()

      if (this.config.autoCapture) {
        this.autoCapture = new AutoCapture(this)
        this.autoCapture.start()
      }

      this.log('Nohmo initialized', this.state)
    } catch (err) {
      this.pendingEvents = []
      this.initResolve()
      console.error('[Nohmo] Failed to initialize:', err)
    }
  }

  send(event: string, data: Record<string, unknown> = {}) {
    const partial: PartialEvent = {
      userId: this.state.userId,
      sessionId: this.state.sessionId,
      event,
      data,
      page: typeof window !== 'undefined' ? window.location.pathname : '',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      ts: Date.now(),
    }

    if (!this.state.deviceId) {
      // init() hasn't resolved the canonical deviceId yet — buffer and drain later
      this.pendingEvents.push(partial)
      this.log('Buffered pre-init event:', event)
      return
    }

    this.queue.push({ ...partial, deviceId: this.state.deviceId })
    this.log('Event queued:', event)
  }

  async linkUser(
    userId: string,
    email?: string,
    meta?: Record<string, unknown>
  ): Promise<void> {
    // Wait for init to complete so we have a valid deviceId and the device
    // record exists in the backend before we try to link it.
    await this.initPromise

    this.state.userId = userId
    this.queue.flush()

    try {
      await fetch(`${_h}${_p.l}`, {
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

      localStorage.setItem('_nohmo_uid', userId)
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
    const url = `${_h}${_p.t}`

    // sendBeacon returns false (not an exception) when it fails — e.g. in some
    // incognito modes or when the browser queue is full. Always fall back to fetch.
    const beaconSent = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    if (beaconSent) {
      this.log(`Flushed ${events.length} events via beacon`)
      return
    }

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
      this.log(`Flushed ${events.length} events via fetch`)
    } catch (err) {
      console.error('[Nohmo] Failed to flush events:', err)
    }
  }

  private generateSessionId(): string {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('_nohmo_sess')
      if (stored) return stored
    }
    const id = 'sess_' + Math.random().toString(36).slice(2, 14)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('_nohmo_sess', id)
    }
    return id
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

// Automatic error & crash capture for the web SDK.
// Emits JS_ERROR (uncaught exceptions + unhandled promise rejections),
// HTTP_ERROR (failed fetch/XHR requests and resource 404s), and EMPTY_RESPONSE
// (a request that succeeded but came back with nothing in it).
// Mirrors the start()/stop() + cleanupFns pattern of AutoCapture.

import { markNetworkActivity } from './activity'

interface ErrorSender {
  send(event: string, data?: Record<string, unknown>): void
  // Crash-class events flush immediately so an error preceding a navigation
  // (or a full page crash) isn't lost in the periodic batch.
  flushNow?(): void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

const MAX_MESSAGE = 1000
const MAX_STACK = 4000
const DEDUP_MS = 5000        // drop an identical signature seen within this window
const RATE_WINDOW_MS = 60000 // rolling window for the per-minute cap
const RATE_MAX = 25          // max errors reported per window (survives error storms)

// ── Empty successful responses ─────────────────────────────────────────────
// A 200 carrying `[]` when the user expected their orders is a total product failure
// that no error monitor will ever report — nothing threw, and the status code says
// everything is fine.
//
// Only bodies at or under this size are inspected. Anything larger is definitionally
// not empty, and skipping them means we never buffer a big response just to look at it.
const EMPTY_BODY_MAX_BYTES = 2048
// Body values that mean "the request worked and returned nothing useful".
const EMPTY_BODY_LITERALS = new Set(['', '[]', '{}', 'null', '""'])
// Common envelope keys — `{"data": []}` is just as empty as `[]`.
const ENVELOPE_KEYS = ['data', 'results', 'items', 'records', 'rows', 'list']
// Empty responses are lower-stakes than crashes, so they get a smaller budget of their own.
const EMPTY_RATE_MAX = 10

export class ErrorCapture {
  private tracker: ErrorSender
  private cleanupFns: (() => void)[] = []
  private recent = new Map<string, number>()
  private windowStart = 0
  private windowCount = 0
  // Separate dedup/rate state so empty responses can never crowd out crash reports.
  private recentEmpty = new Map<string, number>()
  private emptyWindowStart = 0
  private emptyWindowCount = 0
  private xhrMeta = new WeakMap<XMLHttpRequest, { method: string; url: string }>()

  constructor(tracker: ErrorSender) {
    this.tracker = tracker
  }

  start() {
    if (typeof window === 'undefined') return

    const onError = (e: ErrorEvent) => this.onError(e)
    // capture phase so resource-load failures (img/script/link 404s) are seen too
    window.addEventListener('error', onError, true)
    this.cleanupFns.push(() => window.removeEventListener('error', onError, true))

    const onRejection = (e: PromiseRejectionEvent) => this.onRejection(e)
    window.addEventListener('unhandledrejection', onRejection)
    this.cleanupFns.push(() => window.removeEventListener('unhandledrejection', onRejection))

    this.patchFetch()
    this.patchXHR()
  }

  stop() {
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
  }

  // ── Uncaught errors & resource failures ──────────────────────────────────
  private onError(e: ErrorEvent) {
    const target = e.target as (HTMLElement & { src?: string; href?: string }) | null

    // Resource load failure (img/script/link). For these the event target is the
    // element, e.message is empty, and e.error is null.
    if (target && target !== (window as unknown) && typeof target.tagName === 'string') {
      const url = target.src || target.href || ''
      if (!url) return
      const tag = target.tagName.toLowerCase()
      const clean = this.stripQuery(url)
      if (this.isIgnored(clean)) return
      if (!this.allow(`resource:${tag}:${clean}`)) return
      this.tracker.send('HTTP_ERROR', {
        kind: 'resource',
        url: clean,
        method: 'GET',
        status: 0,
        statusText: 'Resource failed to load',
        tag,
        page: this.page(),
      })
      return
    }

    const err = e.error as Error | undefined
    // Cross-origin scripts surface as an opaque "Script error." with no file,
    // line, or stack — there's nothing actionable to report, so drop it.
    if (!err && !e.filename && (!e.message || e.message === 'Script error.')) return

    const message = this.trunc(e.message || err?.message || 'Unknown error', MAX_MESSAGE)
    if (!this.allow(`js:${message}:${e.filename}:${e.lineno}`)) return
    this.emitCrash('JS_ERROR', {
      kind: 'error',
      message,
      stack: err?.stack ? this.trunc(String(err.stack), MAX_STACK) : '',
      filename: e.filename || '',
      lineno: e.lineno || 0,
      colno: e.colno || 0,
      page: this.page(),
    })
  }

  // ── Unhandled promise rejections ─────────────────────────────────────────
  private onRejection(e: PromiseRejectionEvent) {
    const reason = e.reason
    let message = 'Unhandled promise rejection'
    let stack = ''

    if (reason instanceof Error) {
      message = reason.message || message
      stack = reason.stack ? String(reason.stack) : ''
    } else if (typeof reason === 'string') {
      message = reason
    } else if (reason != null) {
      try {
        message = JSON.stringify(reason)
      } catch {
        message = String(reason)
      }
    }

    message = this.trunc(message, MAX_MESSAGE)
    if (!this.allow(`rejection:${message}`)) return
    this.emitCrash('JS_ERROR', {
      kind: 'unhandledrejection',
      message,
      stack: this.trunc(stack, MAX_STACK),
      page: this.page(),
    })
  }

  // ── fetch / XHR network errors ───────────────────────────────────────────
  private patchFetch() {
    if (typeof window.fetch !== 'function') return
    const originalFetch = window.fetch
    const self = this

    window.fetch = function (...args: Parameters<typeof fetch>): Promise<Response> {
      const url = self.urlOf(args[0])
      const method = self.methodOf(args[0], args[1])
      // Tell dead-click detection that this click did cause work, whatever the outcome.
      // Our OWN batch flush must not count: it fires every few seconds regardless of what
      // the user did, and would mask every dead click behind a coincidental heartbeat.
      self.markAppActivity(url)
      // Always invoke the real fetch with the global as receiver to avoid
      // "Illegal invocation" — never change its behaviour.
      return originalFetch.apply(window, args).then(
        (res: Response) => {
          if (res && res.status >= 400) {
            self.reportHttp('fetch', url, method, res.status, res.statusText)
          } else if (res && res.ok) {
            self.inspectForEmptyBody(res, url, method)
          }
          return res
        },
        (err: unknown) => {
          self.reportHttp('fetch', url, method, 0, err instanceof Error ? err.message : 'Network error')
          throw err
        }
      )
    } as typeof fetch

    this.cleanupFns.push(() => { window.fetch = originalFetch })
  }

  private patchXHR() {
    if (typeof XMLHttpRequest === 'undefined') return
    const proto = XMLHttpRequest.prototype
    const originalOpen = proto.open
    const originalSend = proto.send
    const self = this

    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      self.xhrMeta.set(this, { method: (method || 'GET').toUpperCase(), url: String(url) })
      return (originalOpen as AnyFn).apply(this, [method, url, ...rest])
    } as typeof proto.open

    proto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      const meta = self.xhrMeta.get(this)
      if (meta) self.markAppActivity(meta.url)
      if (meta) {
        this.addEventListener('load', () => {
          if (this.status >= 400) {
            self.reportHttp('xhr', meta.url, meta.method, this.status, this.statusText)
            return
          }
          if (this.status >= 200 && this.status < 300) {
            // XHR already holds the decoded body, so unlike fetch there is nothing to
            // clone and no extra buffering to pay for — but ONLY for text-ish response
            // types. Reading .responseText throws for 'blob'/'arraybuffer'/'document',
            // and treating an unreadable body as "" would report every binary download
            // as an empty response. When we cannot see the body, we say nothing.
            const type = this.responseType
            if (type === '' || type === 'text') {
              let body = ''
              try {
                body = this.responseText || ''
              } catch {
                return
              }
              self.reportEmptyIfEmpty('xhr', meta.url, meta.method, this.status, body)
            } else if (type === 'json') {
              // Already parsed for us; check the value directly rather than re-serialising.
              let parsed: unknown
              try {
                parsed = this.response
              } catch {
                return
              }
              if (self.isEmptyValue(parsed)) {
                self.reportEmpty('xhr', meta.url, meta.method, this.status, 0)
              }
            }
          }
        })
        this.addEventListener('error', () => {
          self.reportHttp('xhr', meta.url, meta.method, 0, 'Network error')
        })
      }
      return (originalSend as AnyFn).apply(this, args)
    } as typeof proto.send

    this.cleanupFns.push(() => {
      proto.open = originalOpen
      proto.send = originalSend
    })
  }

  private reportHttp(kind: 'fetch' | 'xhr', url: string, method: string, status: number, statusText: string) {
    if (!this.isTrackableUrl(url)) return // ignore extension / custom-scheme noise (e.g. properties://, chrome-extension://)
    const clean = this.stripQuery(url)
    if (this.isIgnored(clean)) return // never report our own tracking endpoint → no loop
    if (!this.allow(`http:${status}:${method}:${clean}`)) return
    this.tracker.send('HTTP_ERROR', {
      kind,
      url: clean,
      method,
      status,
      statusText: this.trunc(statusText || '', 200),
      page: this.page(),
    })
  }

  private emitCrash(event: string, data: Record<string, unknown>) {
    this.tracker.send(event, data)
    this.tracker.flushNow?.()
  }

  // ── Empty successful responses ───────────────────────────────────────────
  /**
   * Look at a 2xx fetch response only when it is cheap and safe to do so.
   *
   * A body is inspected only if the server declared a Content-Length at or under
   * EMPTY_BODY_MAX_BYTES. That single condition guarantees we never buffer anything
   * large and never touch a streamed or chunked response — a response big enough to
   * lack a length header cannot be empty anyway, so nothing worth reporting is lost.
   */
  private inspectForEmptyBody(res: Response, url: string, method: string) {
    if (!this.isTrackableUrl(url)) return
    const clean = this.stripQuery(url)
    if (this.isIgnored(clean)) return

    const type = res.headers.get('content-type') || ''
    if (!type.includes('json') && !type.includes('text/plain')) return

    const lengthHeader = res.headers.get('content-length')
    if (lengthHeader === null) return
    const length = Number(lengthHeader)
    if (!Number.isFinite(length) || length > EMPTY_BODY_MAX_BYTES) return

    // clone() so the caller's own res.json()/res.text() is completely unaffected.
    let copy: Response
    try {
      copy = res.clone()
    } catch {
      return
    }
    copy.text().then(
      (body) => this.reportEmptyIfEmpty('fetch', url, method, res.status, body),
      () => undefined,
    )
  }

  /** True when an already-parsed JSON value carries no actual content. */
  private isEmptyValue(parsed: unknown): boolean {
    if (parsed === null || parsed === undefined) return true
    if (Array.isArray(parsed)) return parsed.length === 0
    if (typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (Object.keys(obj).length === 0) return true
      // `{"data": []}` / `{"results": null}` are empty in every way that matters to a user.
      for (const key of ENVELOPE_KEYS) {
        if (key in obj) {
          const inner = obj[key]
          if (inner === null || (Array.isArray(inner) && inner.length === 0)) return true
        }
      }
    }
    return false
  }

  /** True when a successful body carries no actual content. */
  private isEmptyBody(body: string): boolean {
    const trimmed = (body || '').trim()
    if (EMPTY_BODY_LITERALS.has(trimmed)) return true
    if (trimmed.length > EMPTY_BODY_MAX_BYTES) return false

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return false      // not JSON and not blank — it carries something
    }
    return this.isEmptyValue(parsed)
  }

  private reportEmptyIfEmpty(
    kind: 'fetch' | 'xhr', url: string, method: string, status: number, body: string,
  ) {
    if (!this.isEmptyBody(body)) return
    this.reportEmpty(kind, url, method, status, (body || '').length)
  }

  private reportEmpty(
    kind: 'fetch' | 'xhr', url: string, method: string, status: number, bytes: number,
  ) {
    const clean = this.stripQuery(url)
    if (this.isIgnored(clean)) return
    // Empty responses get their OWN rate budget. Sharing allow() with JS_ERROR and
    // HTTP_ERROR would let a chatty endpoint returning [] exhaust the per-minute cap and
    // starve real crash reporting, which is the one thing that must always get through.
    if (!this.allowEmpty(`empty:${method}:${clean}`)) return
    this.tracker.send('EMPTY_RESPONSE', {
      kind,
      url: clean,
      method,
      status,
      bytes,
      page: this.page(),
    })
  }

  /** Record a request as evidence the app reacted — unless it is one of ours. */
  private markAppActivity(url: string) {
    if (this.isIgnored(this.stripQuery(url))) return
    markNetworkActivity()
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private allow(signature: string): boolean {
    const now = Date.now()

    const last = this.recent.get(signature)
    if (last !== undefined && now - last < DEDUP_MS) return false
    this.recent.set(signature, now)
    if (this.recent.size > 200) this.recent.clear() // bound memory

    if (now - this.windowStart > RATE_WINDOW_MS) {
      this.windowStart = now
      this.windowCount = 0
    }
    if (this.windowCount >= RATE_MAX) return false
    this.windowCount++
    return true
  }

  /** Dedup + rate limit for EMPTY_RESPONSE, on a budget of its own. */
  private allowEmpty(signature: string): boolean {
    const now = Date.now()

    const last = this.recentEmpty.get(signature)
    if (last !== undefined && now - last < DEDUP_MS) return false
    this.recentEmpty.set(signature, now)
    if (this.recentEmpty.size > 200) this.recentEmpty.clear()

    if (now - this.emptyWindowStart > RATE_WINDOW_MS) {
      this.emptyWindowStart = now
      this.emptyWindowCount = 0
    }
    if (this.emptyWindowCount >= EMPTY_RATE_MAX) return false
    this.emptyWindowCount++
    return true
  }

  private isIgnored(url: string): boolean {
    return url.includes('/api/tracker/')
  }

  // Only real http(s) requests belong to the app. Custom schemes like
  // properties://, chrome-extension://, moz-extension://, data:, blob: come from
  // browser extensions or the platform — not the user's code — so they're never
  // reported as HTTP errors. Relative URLs resolve against the page (http/https).
  private isTrackableUrl(url: string): boolean {
    try {
      const base = typeof window !== 'undefined' ? window.location.href : undefined
      const protocol = new URL(url, base).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }

  private urlOf(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.toString()
    if (input && typeof input === 'object' && 'url' in input) return (input as Request).url
    return String(input)
  }

  private methodOf(input: RequestInfo | URL, init?: RequestInit): string {
    if (init?.method) return init.method.toUpperCase()
    if (input && typeof input === 'object' && 'method' in input) return (input as Request).method.toUpperCase()
    return 'GET'
  }

  private stripQuery(url: string): string {
    const i = url.indexOf('?')
    return i === -1 ? url : url.slice(0, i)
  }

  private trunc(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) : s
  }

  private page(): string {
    return typeof window !== 'undefined' ? window.location.pathname : ''
  }
}

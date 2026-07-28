import { hadNetworkActivitySince } from './activity'

interface TrackerSender {
  send(event: string, data?: Record<string, unknown>): void
}

interface ClickRecord {
  count: number
  ts: number
}

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

const RELEVANT_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'FORM'])

// ── Dead-click detection ───────────────────────────────────────────────────
// A click on something clickable that produces no navigation, no content change and no
// network request is, from the user's point of view, broken — even though nothing threw
// and no error monitor will ever see it.
//
// How long to wait before judging. Long enough for a request to start and React to
// commit; short enough that the user has genuinely noticed nothing happened.
const DEAD_CLICK_WINDOW_MS = 2500
// Don't report the same control more than once per this window (a frustrated user
// clicks a broken button many times; that is one bug, not fifteen).
const DEAD_CLICK_DEDUP_MS = 10000
// Elements a user expects to act on. Anything else is usually just the page background.
const ACTIONABLE_TAGS = new Set(['a', 'button'])
const ACTIONABLE_INPUT_TYPES = new Set(['submit', 'button'])

// Attributes whose change means the app genuinely reacted, watched alongside DOM
// content changes.
//
// Plenty of working controls respond without adding or removing a single node: a
// dropdown flips aria-expanded, a submit button goes disabled while it posts, a
// <details> gets open, a headless-UI component flips data-state. Judging on content
// changes alone reports every one of those as broken.
//
// `class` and `style` are deliberately absent. They are the noisiest attributes on the
// page — every hover, focus ring and transition writes to them — so including them
// would mark essentially every click as alive and silently switch the detector off.
// Everything below is semantic state that hover and focus never touch.
const STATE_ATTRIBUTES = [
  'aria-expanded', 'aria-selected', 'aria-checked', 'aria-pressed',
  'aria-hidden', 'aria-busy', 'aria-disabled', 'aria-invalid',
  'disabled', 'open', 'hidden', 'checked', 'value', 'selected',
  'data-state', 'data-open', 'data-loading',
]

export class AutoCapture {
  private tracker: TrackerSender
  private clickCounts: Map<string, ClickRecord>
  private cleanupFns: (() => void)[]
  // Bumped by the MutationObserver whenever the app visibly reacts — content added or
  // removed, text changed, or one of STATE_ATTRIBUTES toggled.
  private contentChanges = 0
  private observer: MutationObserver | null = null
  // A Set, not an array: each timer removes itself when it fires, so this stays bounded
  // by the clicks currently in flight and stop() can always clear every live one. The
  // array version had to be sliced to stay bounded, which dropped the handles it sliced
  // off — leaving timers stop() could no longer cancel.
  private deadClickTimers: Set<ReturnType<typeof setTimeout>> = new Set()
  private lastDeadReport: Map<string, number> = new Map()
  private stopped = false

  constructor(tracker: TrackerSender) {
    this.tracker = tracker
    this.clickCounts = new Map()
    this.cleanupFns = []
  }

  start() {
    if (typeof document === 'undefined') return
    this.stopped = false

    const onClick = (e: MouseEvent) => this.captureClick(e)
    document.addEventListener('click', onClick, true)
    this.cleanupFns.push(() => document.removeEventListener('click', onClick, true))

    const onSubmit = (e: SubmitEvent) => this.captureSubmit(e)
    document.addEventListener('submit', onSubmit, true)
    this.cleanupFns.push(() => document.removeEventListener('submit', onSubmit, true))

    const onChange = (e: Event) => this.captureInput(e)
    document.addEventListener('change', onChange, true)
    this.cleanupFns.push(() => document.removeEventListener('change', onChange, true))

    this.startMutationWatch()
  }

  stop() {
    this.stopped = true
    this.deadClickTimers.forEach((t) => clearTimeout(t))
    this.deadClickTimers.clear()
    this.observer?.disconnect()
    this.observer = null
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
  }

  private startMutationWatch() {
    if (typeof MutationObserver === 'undefined' || !document.documentElement) return
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        // A childList record that neither added nor removed anything is a reorder we
        // can't attribute to a response; everything else here is a real reaction.
        if (r.type === 'childList' && !r.addedNodes.length && !r.removedNodes.length) continue
        this.contentChanges++
        return      // one is enough — we only need to know THAT something happened
      }
    })
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: STATE_ATTRIBUTES,
    })
  }

  /**
   * Whether this element's job is to do something OUTSIDE the current page — open a mail
   * client, dial a number, start a download, open a new tab, or submit to another origin.
   *
   * All of those leave the page's URL, DOM and network untouched, so the dead-click test
   * would call them broken every single time. They are working exactly as intended; we
   * simply have no way to observe the outcome, so we decline to judge them.
   */
  private actsOutsideThePage(el: HTMLElement): boolean {
    const anchor = el as HTMLAnchorElement
    const rawHref = el.getAttribute?.('href') ?? ''
    if (rawHref) {
      const scheme = rawHref.slice(0, rawHref.indexOf(':') + 1).toLowerCase()
      // Non-http(s) schemes hand off to the OS: mailto:, tel:, sms:, intent:, app links…
      if (scheme && scheme !== 'http:' && scheme !== 'https:') return true
    }
    if (el.hasAttribute?.('download')) return true
    const target = anchor.target || el.getAttribute?.('target') || ''
    if (target && target !== '_self') return true
    // A form button that posts to another origin navigates away from our observation too.
    const formAction = (el as HTMLButtonElement).formAction || ''
    if (formAction && !formAction.startsWith(window.location.origin)) return true
    return false
  }

  private isActionable(el: HTMLElement): boolean {
    const tag = el.tagName.toLowerCase()
    if (ACTIONABLE_TAGS.has(tag)) return true
    const type = (el as HTMLInputElement).type?.toLowerCase()
    if (type && ACTIONABLE_INPUT_TYPES.has(type)) return true
    if ((el as HTMLAnchorElement).href) return true
    if (el.getAttribute('role') === 'button') return true
    return !!(el.dataset.track || el.dataset.nohmo)
  }

  /**
   * Watch what a click actually did. Fires DEAD_CLICK only when nothing at all happened:
   * no navigation, no DOM content change, no network request.
   *
   * Deliberately biased toward silence. Every ambiguous signal is read as "the app
   * responded", so this under-reports rather than crying wolf — a false dead click sends
   * an engineer hunting for a bug that does not exist, which is worse than missing one.
   * The server-side detector in the backend catches what this misses.
   */
  private watchForDeadClick(el: HTMLElement, props: Record<string, unknown>) {
    if (typeof window === 'undefined') return
    if (this.actsOutsideThePage(el)) return

    const selector = String(props.selector ?? '')
    const dedupKey = `${this.page()}|${selector}|${String(props.text ?? '')}`
    const last = this.lastDeadReport.get(dedupKey)
    const clickedAt = Date.now()
    if (last !== undefined && clickedAt - last < DEAD_CLICK_DEDUP_MS) return

    const changesAtClick = this.contentChanges
    const urlAtClick = window.location.href
    // A link that leaves the page entirely: the timer never runs, so nothing is reported.
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      // Drop our own handle first, so the set stays bounded by the number of clicks
      // actually in flight rather than growing for the life of the session.
      this.deadClickTimers.delete(timer)
      if (this.stopped) return
      if (window.location.href !== urlAtClick) return          // navigated
      if (this.contentChanges > changesAtClick) return          // rendered something
      if (hadNetworkActivitySince(clickedAt)) return            // asked the server
      if (document.hidden) return                               // user left the tab; can't judge

      // Re-check the dedup at REPORT time, not just at click time. A frustrated user
      // jabbing a dead button three times arms three timers before any of them has fired,
      // so the click-time check alone would let all three through and report one broken
      // control as three separate failures.
      const reportedAt = Date.now()
      const already = this.lastDeadReport.get(dedupKey)
      if (already !== undefined && reportedAt - already < DEAD_CLICK_DEDUP_MS) return

      this.lastDeadReport.set(dedupKey, reportedAt)
      if (this.lastDeadReport.size > 100) this.lastDeadReport.clear()
      this.tracker.send('DEAD_CLICK', {
        ...props,
        waitedMs: DEAD_CLICK_WINDOW_MS,
      })
    }, DEAD_CLICK_WINDOW_MS)

    this.deadClickTimers.add(timer)
  }

  private page(): string {
    return typeof window !== 'undefined' ? window.location.pathname : ''
  }

  private captureClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (!target) return
    if (target.closest('[data-nohmo-ignore]')) return

    const element = this.getRelevantElement(target)
    if (!element) return

    const props = this.extractElementProps(element)

    const key = `${Math.round(e.clientX / 10)},${Math.round(e.clientY / 10)}`
    const existing = this.clickCounts.get(key)
    const now = Date.now()

    if (existing && now - existing.ts < 1000) {
      existing.count++
      existing.ts = now
      if (existing.count === 3) {
        this.tracker.send('RAGE_CLICK', { ...props, x: e.clientX, y: e.clientY })
      }
    } else {
      this.clickCounts.set(key, { count: 1, ts: now })
    }

    this.tracker.send('CLICK', { ...props, x: e.clientX, y: e.clientY })

    if (this.isActionable(element)) {
      this.watchForDeadClick(element, props)
    }
  }

  private captureSubmit(e: SubmitEvent) {
    const form = e.target as HTMLFormElement
    if (!form) return
    if (form.closest('[data-nohmo-ignore]')) return

    const fields = Array.from(form.elements)
      .filter((el): el is FormField =>
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      )
      .filter((el) => (el as HTMLInputElement).type !== 'password')
      .map((el) => ({
        name: el.name || el.id || (el instanceof HTMLInputElement ? el.type : el.tagName),
        type: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
        required: el.required,
      }))

    this.tracker.send('FORM_SUBMIT', {
      formId: form.id || null,
      formName: form.getAttribute('name') || null,
      action: form.action || null,
      fieldCount: fields.length,
      fields,
    })
  }

  private captureInput(e: Event) {
    const input = e.target as HTMLInputElement
    if (!input) return
    if (input.closest('[data-nohmo-ignore]')) return

    if (
      input.type === 'password' ||
      input.type === 'hidden' ||
      input.hasAttribute('data-sensitive') ||
      input.autocomplete?.includes('cc') ||
      input.autocomplete?.includes('password')
    ) return

    this.tracker.send('INPUT_CHANGE', {
      fieldName: input.name || input.id || input.placeholder || null,
      fieldType: input.type,
      tag: input.tagName.toLowerCase(),
    })
  }

  private getRelevantElement(target: HTMLElement): HTMLElement {
    let el: HTMLElement | null = target

    for (let i = 0; i < 5; i++) {
      if (!el) return target
      if (RELEVANT_TAGS.has(el.tagName)) return el
      if (el.dataset.track || el.dataset.nohmo) return el
      el = el.parentElement
    }

    return target
  }

  private extractElementProps(el: HTMLElement): Record<string, unknown> {
    const dataAttrs: Record<string, string> = {}
    Array.from(el.attributes)
      .filter((a) => a.name.startsWith('data-'))
      .forEach((a) => {
        dataAttrs[a.name.slice(5)] = a.value
      })

    return {
      tag: el.tagName.toLowerCase(),
      text: this.getCleanText(el),
      id: el.id || null,
      name: (el as HTMLInputElement).name || null,
      href: (el as HTMLAnchorElement).href || null,
      classes: el.className || null,
      type: (el as HTMLInputElement).type || null,
      dataAttributes: dataAttrs,
      selector: this.getSelector(el),
    }
  }

  private getCleanText(el: HTMLElement): string {
    return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
  }

  private getSelector(el: HTMLElement): string {
    let selector = el.tagName.toLowerCase()
    if (el.id) selector += `#${el.id}`
    if (el.className) {
      const classes = el.className
        .split(' ')
        .filter((c) => c.length > 0)
        .slice(0, 3)
        .join('.')
      if (classes) selector += `.${classes}`
    }
    return selector
  }
}

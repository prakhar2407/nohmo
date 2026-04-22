interface TrackerSender {
  send(event: string, data?: Record<string, unknown>): void
}

interface ClickRecord {
  count: number
  ts: number
}

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

const RELEVANT_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'FORM'])

export class AutoCapture {
  private tracker: TrackerSender
  private clickCounts: Map<string, ClickRecord>
  private cleanupFns: (() => void)[]

  constructor(tracker: TrackerSender) {
    this.tracker = tracker
    this.clickCounts = new Map()
    this.cleanupFns = []
  }

  start() {
    if (typeof document === 'undefined') return

    const onClick = (e: MouseEvent) => this.captureClick(e)
    document.addEventListener('click', onClick, true)
    this.cleanupFns.push(() => document.removeEventListener('click', onClick, true))

    const onSubmit = (e: SubmitEvent) => this.captureSubmit(e)
    document.addEventListener('submit', onSubmit, true)
    this.cleanupFns.push(() => document.removeEventListener('submit', onSubmit, true))

    const onChange = (e: Event) => this.captureInput(e)
    document.addEventListener('change', onChange, true)
    this.cleanupFns.push(() => document.removeEventListener('change', onChange, true))
  }

  stop() {
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
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

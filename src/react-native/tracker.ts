import { AppState, Platform, Dimensions, Linking, NativeModules } from 'react-native'
import type { NohmoRNConfig, NohmoRNEvent, NohmoStorage } from './types'


function makeMemoryStorage(): NohmoStorage {
  const store: Record<string, string> = {}
  return {
    getItem: async (key) => store[key] ?? null,
    setItem: async (key, value) => { store[key] = value },
  }
}

const _h = 'https://www.nohmo.in'
const _p = {
  i:   '/api/tracker/identify/',
  t:   '/api/tracker/track/',
  l:   '/api/tracker/link-user/',
  pt:  '/api/tracker/push-token/',
  a:   '/api/tracker/attribute/',
  inv: '/api/tracker/invite-link/',
}

const KEYS = {
  deviceId:    '@nohmo_did',
  userId:      '@nohmo_uid',
  firstOpen:   '@nohmo_first',
  installAttr: '@nohmo_install_attr',
}

function genId(prefix: string) {
  return `${prefix}_` + Math.random().toString(36).slice(2, 14) + Date.now().toString(36)
}

function parseDeepLinkUtm(url: string | null): Record<string, string> {
  if (!url) return {}
  try {
    const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '')
    const utm: Record<string, string> = {}
    params.forEach((v, k) => {
      if (k.startsWith('utm_') || k === 'ref') utm[k] = v
    })
    return utm
  } catch {
    return {}
  }
}

type PartialEvent = Omit<NohmoRNEvent, 'deviceId'>

export class NohmoRNTracker {
  private config: Required<NohmoRNConfig>
  private storage: NohmoStorage
  private deviceId: string | null = null
  private userId: string | null = null
  private sessionId: string
  private currentScreen = ''
  private sessionStart = Date.now()
  private queue: NohmoRNEvent[] = []
  private pendingEvents: PartialEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null
  private initResolve: () => void = () => {}
  private readonly initPromise: Promise<void>
  private deepLinkUtm: Record<string, string> = {}
  private installAttr: Record<string, string> = {}
  private installAttrAttempted = false
  private inviteCache: Record<string, string> = {}

  constructor(config: NohmoRNConfig) {
    this.config = {
      flushInterval: 5000,
      debug: false,
      autoAppLifecycle: true,
      appVersion: '',
      storage: makeMemoryStorage(),
      ...config,
    }
    this.storage = this.config.storage
    this.sessionId = genId('sess')
    this.initPromise = new Promise(r => { this.initResolve = r })
  }

  async init(): Promise<void> {
    try {
      // Read persisted IDs
      const [storedDeviceId, storedUserId, firstOpenDone, initialUrl, storedInstallAttr] = await Promise.all([
        this.storage.getItem(KEYS.deviceId),
        this.storage.getItem(KEYS.userId),
        this.storage.getItem(KEYS.firstOpen),
        Linking.getInitialURL(),
        this.storage.getItem(KEYS.installAttr),
      ])

      this.deepLinkUtm = parseDeepLinkUtm(initialUrl)
      if (storedInstallAttr) {
        try { this.installAttr = JSON.parse(storedInstallAttr) } catch { /* ignore */ }
      }

      // Device ID — generate once, persist forever
      let deviceId = storedDeviceId ?? genId('did')
      if (!storedDeviceId) await this.storage.setItem(KEYS.deviceId, deviceId)

      this.userId = storedUserId ?? null

      // Identify with backend
      try {
        const screen = Dimensions.get('screen')
        const res = await fetch(`${_h}${_p.i}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
          body: JSON.stringify({
            deviceId,
            knownUserId: this.userId ?? undefined,
            platform: Platform.OS,
            appVersion: this.config.appVersion,
            osVersion: `${Platform.OS} ${Platform.Version}`,
            deviceInfo: {
              type: 'mobile',
              os: Platform.OS,
              browser: 'native',
              browserVersion: this.config.appVersion,
              screenW: screen.width,
              screenH: screen.height,
              viewportW: screen.width,
              viewportH: screen.height,
              pixelRatio: screen.scale,
              language: 'en',
              timezone: (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function')
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : 'UTC',
              touch: true,
              platform: Platform.OS,
              appVersion: this.config.appVersion,
            },
          }),
        })
        const json = await res.json() as { success: boolean; data?: { deviceId?: string; userId?: string } }
        const data = json.data ?? {}
        deviceId = data.deviceId ?? deviceId
        if (data.userId) this.userId = data.userId
      } catch {
        // fallback to local deviceId
      }

      this.deviceId = deviceId
      await this.storage.setItem(KEYS.deviceId, deviceId)

      // Drain buffered pre-init events
      for (const e of this.pendingEvents) {
        this.queue.push({ ...e, deviceId })
      }
      this.pendingEvents = []

      // Track install (only on very first open)
      if (!firstOpenDone) {
        await this.storage.setItem(KEYS.firstOpen, '1')
        this.send('APP_INSTALL', {
          platform: Platform.OS,
          appVersion: this.config.appVersion,
          osVersion: String(Platform.Version),
        })

        // Attempt attribution on all platforms:
        //   Android — reads Play Store referrer via native module (deterministic)
        //   iOS     — reads pasteboard token written by the Nohmo click-link page (deterministic)
        //   Both    — fall back to a backend attribution ping for probabilistic IP matching
        await this._autoReadInstallReferrer()
      }

      // Track open
      this.send('APP_OPEN', {
        platform: Platform.OS,
        appVersion: this.config.appVersion,
      })

      // App lifecycle
      if (this.config.autoAppLifecycle) {
        this.appStateSubscription = AppState.addEventListener('change', this._onAppStateChange)
      }

      // Flush timer
      this.flushTimer = setInterval(() => this._flush(), this.config.flushInterval)

      this.initResolve()
      this._log('Nohmo RN initialized', { deviceId, userId: this.userId })
    } catch (err) {
      this.initResolve()
      console.error('[Nohmo RN] Init failed:', err)
    }
  }

  send(event: string, data: Record<string, unknown> = {}) {
    const partial: PartialEvent = {
      userId: this.userId,
      sessionId: this.sessionId,
      event,
      data,
      screen: this.currentScreen,
      referrer: '',
      ts: Date.now(),
      platform: Platform.OS as 'ios' | 'android',
      appVersion: this.config.appVersion,
      ...(Object.keys(this.deepLinkUtm).length > 0 ? { utm: this.deepLinkUtm } : {}),
      ...(Object.keys(this.installAttr).length > 0 ? { install_utm: this.installAttr } : {}),
    }

    if (!this.deviceId) {
      this.pendingEvents.push(partial)
      this._log('Buffered pre-init event:', event)
      return
    }

    this.queue.push({ ...partial, deviceId: this.deviceId })
    this._log('Event queued:', event)
  }

  trackScreenView(screenName: string) {
    const prev = this.currentScreen
    if (prev && prev !== screenName) {
      const secs = Math.round((Date.now() - this.sessionStart) / 1000)
      if (secs > 0) {
        this.send('TIME_SPENT', { screen: prev, seconds: secs })
      }
    }
    this.currentScreen = screenName
    this.sessionStart = Date.now()
    this.send('SCREEN_VIEW', { screen: screenName })
  }

  trackConversion(slug: string, properties: Record<string, unknown> = {}) {
    this.send('CONVERSION', { slug, ...properties })
  }

  /**
   * Build a short, shareable Nohmo attribution link for "invite a friend" flows.
   * Share THIS (not the raw store URL) so installs are attributed back to the
   * sharer: the current linked user id rides along as utm_content, so you can
   * see who referred whom. Returns a tidy short URL (https://www.nohmo.in/api/l/
   * <code>); the same user + options always resolves to the same code. Falls back
   * to the full click URL if the device is offline. Call linkUser first so the
   * referrer is captured.
   *
   * @example
   *   const link = await nohmo.buildInviteLink({ channel: 'whatsapp' })
   *   Share.share({ message: `Join me! ${link}` })
   */
  async buildInviteLink(opts: { channel?: string; campaign?: string; source?: string } = {}): Promise<string> {
    const source = opts.source || 'referral'
    const key = `${source}|${opts.channel || ''}|${opts.campaign || ''}|${this.userId || ''}`
    if (this.inviteCache[key]) return this.inviteCache[key]

    try {
      const res = await fetch(`${_h}${_p.inv}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
        body: JSON.stringify({
          source,
          medium: opts.channel || '',
          campaign: opts.campaign || '',
          content: this.userId || '',
        }),
      })
      const data = await res.json()
      if (data && data.shortCode) {
        const url = `${_h}/api/l/${data.shortCode}/`
        this.inviteCache[key] = url
        return url
      }
    } catch (err) {
      this._log('buildInviteLink: short link unavailable, using full URL:', err)
    }

    // Offline / error fallback — the long but always-working click URL
    return this._fullInviteLink(opts)
  }

  private _fullInviteLink(opts: { channel?: string; campaign?: string; source?: string }): string {
    const parts: string[] = []
    const add = (key: string, value?: string | null) => {
      if (value) parts.push(`${key}=${encodeURIComponent(value)}`)
    }
    add('utm_source', opts.source || 'referral')
    add('utm_medium', opts.channel)
    add('utm_campaign', opts.campaign)
    add('utm_content', this.userId)
    const qs = parts.length ? `?${parts.join('&')}` : ''
    return `${_h}/api/click/${this.config.projectId}/${qs}`
  }

  async linkUser(userId: string, email?: string, meta?: Record<string, unknown>): Promise<void> {
    await this.initPromise
    this.userId = userId
    await this.storage.setItem(KEYS.userId, userId)
    this._flush()

    try {
      await fetch(`${_h}${_p.l}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
        body: JSON.stringify({
          deviceId: this.deviceId,
          userId,
          email: email ?? '',
          meta: meta ?? {},
        }),
      })
      this.send('USER_LINKED', { userId, email })
      this._log('User linked:', userId)
    } catch (err) {
      console.error('[Nohmo RN] linkUser failed:', err)
    }
  }

  async setInstallReferrer(referrerString: string): Promise<void> {
    // Skip the await when deviceId is already set — avoids a deadlock when this
    // is called from within init() via _autoReadInstallReferrer (initResolve()
    // hasn't fired yet at that point, so awaiting initPromise would hang forever).
    if (!this.deviceId) await this.initPromise
    if (!referrerString) return
    // Guard covers both UTM-based and nohmo_click-only referrers
    if (this.installAttrAttempted) return
    this.installAttrAttempted = true

    // Parse UTM params for local storage / INSTALL_ATTRIBUTED event
    const parsed = parseDeepLinkUtm('?' + referrerString)
    if (Object.keys(parsed).length > 0) {
      this.installAttr = parsed
      await this.storage.setItem(KEYS.installAttr, JSON.stringify(parsed))
      this.send('INSTALL_ATTRIBUTED', { ...parsed })
      this._log('Install attributed:', parsed)
    }

    // Always forward the raw string — backend extracts nohmo_click for deterministic matching
    // even when the referrer contains no utm_* params
    try {
      await fetch(`${_h}${_p.a}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
        body: JSON.stringify({
          deviceId: this.deviceId,
          installReferrer: referrerString,
          platform: Platform.OS,
        }),
      })
    } catch { /* non-critical */ }
  }

  private async _autoReadInstallReferrer(): Promise<void> {
    // Android: Play Store preserves the referrer query string set by ClickView.
    // iOS: pasteboard token written by the Nohmo click-link interstitial page.
    // Both expose the same NativeModules.NohmoInstallReferrer.getReferrer() API.
    try {
      const mod = NativeModules.NohmoInstallReferrer
      if (mod?.getReferrer) {
        const referrer: string = await mod.getReferrer()
        if (referrer) {
          await this.setInstallReferrer(referrer)
          return
        }
      }
    } catch { /* native module unavailable */ }

    // Fallback: ping the attribution endpoint with no referrer string so the
    // backend can attempt probabilistic IP matching (covers iOS users who didn't
    // tap the interstitial button, or any platform without the native module).
    if (this.installAttrAttempted) return
    this.installAttrAttempted = true
    try {
      await fetch(`${_h}${_p.a}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
        body: JSON.stringify({
          deviceId: this.deviceId,
          installReferrer: '',
          platform: Platform.OS,
        }),
      })
    } catch { /* non-critical */ }
  }

  async registerPushToken(token: string): Promise<void> {
    await this.initPromise
    if (!token || !this.deviceId) return
    try {
      await fetch(`${_h}${_p.pt}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
        body: JSON.stringify({ deviceId: this.deviceId, pushToken: token }),
      })
      this._log('Push token registered')
    } catch (err) {
      this._log('registerPushToken failed:', err)
    }
  }

  private _onAppStateChange = (nextState: string) => {
    if (nextState === 'background' || nextState === 'inactive') {
      const secs = Math.round((Date.now() - this.sessionStart) / 1000)
      if (secs > 0) {
        this.send('APP_BACKGROUND', {
          platform: Platform.OS,
          sessionDurationSecs: secs,
          screen: this.currentScreen,
        })
      }
      this._flush()
    } else if (nextState === 'active') {
      this.sessionId = genId('sess')
      this.sessionStart = Date.now()
      this.send('APP_OPEN', { platform: Platform.OS, appVersion: this.config.appVersion })
    }
  }

  private async _flush() {
    if (!this.queue.length) return
    const batch = this.queue.splice(0)

    const body = JSON.stringify({
      events: batch.map(e => ({
        deviceId: e.deviceId,
        userId: e.userId,
        sessionId: e.sessionId,
        event: e.event,
        data: e.data,
        page: e.screen,
        referrer: e.referrer,
        ts: e.ts,
        ...(e.utm ? { utm: e.utm } : {}),
        ...(e.install_utm ? { install_utm: e.install_utm } : {}),
      })),
      apiKey: this.config.apiKey,
    })

    try {
      await fetch(`${_h}${_p.t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      this._log(`Flushed ${batch.length} events`)
    } catch (err) {
      // Re-queue on failure
      this.queue.unshift(...batch)
      this._log('Flush failed, re-queued:', err)
    }
  }

  private _log(...args: unknown[]) {
    if (this.config.debug) console.log('[Nohmo RN]', ...args)
  }

  destroy() {
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.appStateSubscription?.remove()
    this._flush()
  }
}

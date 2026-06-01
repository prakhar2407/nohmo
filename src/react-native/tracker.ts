import { AppState, Platform, Dimensions, Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { NohmoRNConfig, NohmoRNEvent } from './types'

const _b = (s: string) => Buffer.from(s, 'base64').toString()
const _h = 'https://www.nohmo.in'
const _p = {
  i:  '/api/tracker/identify/',
  t:  '/api/tracker/track/',
  l:  '/api/tracker/link-user/',
  pt: '/api/tracker/push-token/',
}

const KEYS = {
  deviceId:  '@nohmo_did',
  userId:    '@nohmo_uid',
  firstOpen: '@nohmo_first',
}

function genId(prefix: string) {
  return `${prefix}_` + Math.random().toString(36).slice(2, 14) + Date.now().toString(36)
}

function parseDeepLinkUtm(url: string | null): Record<string, string> {
  if (!url) return {}
  try {
    const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '')
    const utm: Record<string, string> = {}
    for (const [k, v] of params.entries()) {
      if (k.startsWith('utm_') || k === 'ref') utm[k] = v
    }
    return utm
  } catch {
    return {}
  }
}

type PartialEvent = Omit<NohmoRNEvent, 'deviceId'>

export class NohmoRNTracker {
  private config: Required<NohmoRNConfig>
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

  constructor(config: NohmoRNConfig) {
    this.config = {
      flushInterval: 5000,
      debug: false,
      autoAppLifecycle: true,
      appVersion: '',
      ...config,
    }
    this.sessionId = genId('sess')
    this.initPromise = new Promise(r => { this.initResolve = r })
  }

  async init(): Promise<void> {
    try {
      // Read persisted IDs
      const [storedDeviceId, storedUserId, firstOpenDone, initialUrl] = await Promise.all([
        AsyncStorage.getItem(KEYS.deviceId),
        AsyncStorage.getItem(KEYS.userId),
        AsyncStorage.getItem(KEYS.firstOpen),
        Linking.getInitialURL(),
      ])

      this.deepLinkUtm = parseDeepLinkUtm(initialUrl)

      // Device ID — generate once, persist forever
      let deviceId = storedDeviceId ?? genId('did')
      if (!storedDeviceId) await AsyncStorage.setItem(KEYS.deviceId, deviceId)

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
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      await AsyncStorage.setItem(KEYS.deviceId, deviceId)

      // Drain buffered pre-init events
      for (const e of this.pendingEvents) {
        this.queue.push({ ...e, deviceId })
      }
      this.pendingEvents = []

      // Track install (only on very first open)
      if (!firstOpenDone) {
        await AsyncStorage.setItem(KEYS.firstOpen, '1')
        this.send('APP_INSTALL', {
          platform: Platform.OS,
          appVersion: this.config.appVersion,
          osVersion: String(Platform.Version),
        })
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

  async linkUser(userId: string, email?: string, meta?: Record<string, unknown>): Promise<void> {
    await this.initPromise
    this.userId = userId
    await AsyncStorage.setItem(KEYS.userId, userId)
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

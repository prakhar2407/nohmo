export interface NohmoStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export interface NohmoRNConfig {
  projectId: string
  apiKey: string
  appVersion?: string
  flushInterval?: number
  debug?: boolean
  autoAppLifecycle?: boolean
  storage?: NohmoStorage
}

export interface NohmoRNEvent {
  deviceId: string
  userId: string | null
  sessionId: string
  event: string
  data: Record<string, unknown>
  screen: string
  referrer: string
  ts: number
  platform: 'ios' | 'android'
  appVersion: string
  utm?: Record<string, string>
}

export interface NohmoRNContextValue {
  send: (event: string, data?: Record<string, unknown>) => void
  trackScreenView: (screenName: string) => void
  trackConversion: (slug: string, properties?: Record<string, unknown>) => void
  linkUser: (userId: string, email?: string, meta?: Record<string, unknown>) => Promise<void>
  registerPushToken: (token: string) => Promise<void>
}

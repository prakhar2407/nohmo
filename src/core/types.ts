export type { DeviceInfo } from './fingerprint'
export type { UTMParams } from './utm'

export interface NohmoConfig {
  projectId: string
  apiKey: string
  flushInterval?: number
  debug?: boolean
  autoPageView?: boolean
  autoScrollDepth?: boolean
  autoTimeSpent?: boolean
  autoCapture?: boolean
  /**
   * Custom URL parameter names to treat as attribution when no utm_* params
   * are present. Checked in order; the first match becomes source and the
   * param name itself becomes medium so it's identifiable in the dashboard.
   * Defaults to ['ref'].
   * Example: ['ref', 'reference', 'src', 'from']
   */
  attributionParams?: string[]
}

export interface NohmoEvent {
  deviceId: string
  userId: string | null
  sessionId: string
  event: string
  data: Record<string, unknown>
  page: string
  referrer: string
  ts: number
  utm?: import('./utm').UTMParams
}

export interface NohmoUser {
  userId: string
  email?: string
  meta?: Record<string, unknown>
}

export interface NohmoState {
  deviceId: string | null
  userId: string | null
  sessionId: string
  ready: boolean
}

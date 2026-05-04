export interface NohmoConfig {
  projectId: string
  apiKey: string
  flushInterval?: number
  debug?: boolean
  autoPageView?: boolean
  autoScrollDepth?: boolean
  autoTimeSpent?: boolean
  autoCapture?: boolean
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

import React, { createContext, useContext, useEffect, useRef } from 'react'
import { NohmoRNTracker } from './tracker'
import type { NohmoRNConfig, NohmoRNContextValue } from './types'

const NohmoRNContext = createContext<NohmoRNContextValue>({
  send: () => undefined,
  trackScreenView: () => undefined,
  trackConversion: () => undefined,
  linkUser: async () => undefined,
  registerPushToken: async () => undefined,
})

interface NohmoProviderProps {
  children: React.ReactNode
  projectId: string
  apiKey: string
  options?: Partial<Omit<NohmoRNConfig, 'projectId' | 'apiKey'>>
}

export function NohmoProvider({
  children,
  projectId,
  apiKey,
  options = {},
}: NohmoProviderProps) {
  const trackerRef = useRef<NohmoRNTracker | null>(null)
  type PendingLink = [string, string | undefined, Record<string, unknown> | undefined]
  const pendingLinksRef = useRef<PendingLink[]>([])

  useEffect(() => {
    const tracker = new NohmoRNTracker({ projectId, apiKey, ...options })
    trackerRef.current = tracker

    const pending = pendingLinksRef.current.splice(0)
    if (pending.length) {
      for (const [userId, email, meta] of pending) {
        tracker.linkUser(userId, email, meta)
      }
    }

    tracker.init()

    return () => { tracker.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (event: string, data: Record<string, unknown> = {}) => {
    trackerRef.current?.send(event, data)
  }

  const trackScreenView = (screenName: string) => {
    trackerRef.current?.trackScreenView(screenName)
  }

  const trackConversion = (slug: string, properties?: Record<string, unknown>) => {
    trackerRef.current?.trackConversion(slug, properties)
  }

  const linkUser = async (userId: string, email?: string, meta?: Record<string, unknown>) => {
    if (!trackerRef.current) {
      pendingLinksRef.current.push([userId, email, meta])
      return
    }
    await trackerRef.current.linkUser(userId, email, meta)
  }

  const registerPushToken = async (token: string) => {
    await trackerRef.current?.registerPushToken(token)
  }

  return (
    <NohmoRNContext.Provider value={{ send, trackScreenView, trackConversion, linkUser, registerPushToken }}>
      {children}
    </NohmoRNContext.Provider>
  )
}

export function useNohmo(): NohmoRNContextValue {
  return useContext(NohmoRNContext)
}

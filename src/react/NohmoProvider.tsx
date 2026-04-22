'use client'

import React, { createContext, useContext, useEffect, useRef } from 'react'
import { NohmoTracker } from '../core/tracker'
import type { NohmoConfig } from '../core/types'

interface NohmoContextValue {
  tracker: NohmoTracker | null
  send: (event: string, data?: Record<string, unknown>) => void
  linkUser: (
    userId: string,
    email?: string,
    meta?: Record<string, unknown>
  ) => Promise<void>
}

const NohmoContext = createContext<NohmoContextValue>({
  tracker: null,
  send: () => undefined,
  linkUser: async () => undefined,
})

interface NohmoProviderProps {
  children: React.ReactNode
  projectId: string
  apiKey: string
  apiUrl: string
  options?: Partial<NohmoConfig>
}

export function NohmoProvider({
  children,
  projectId,
  apiKey,
  apiUrl,
  options = {},
}: NohmoProviderProps) {
  const trackerRef = useRef<NohmoTracker | null>(null)

  useEffect(() => {
    const tracker = new NohmoTracker({
      projectId,
      apiKey,
      apiUrl,
      ...options,
    })

    trackerRef.current = tracker
    tracker.init()

    let cleanupScroll: (() => void) | undefined
    if (options.autoScrollDepth !== false) {
      cleanupScroll = tracker.startScrollTracking()
    }

    return () => {
      cleanupScroll?.()
      tracker.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (event: string, data: Record<string, unknown> = {}) => {
    trackerRef.current?.send(event, data)
  }

  const linkUser = async (
    userId: string,
    email?: string,
    meta?: Record<string, unknown>
  ) => {
    await trackerRef.current?.linkUser(userId, email, meta)
  }

  return (
    <NohmoContext.Provider value={{ tracker: trackerRef.current, send, linkUser }}>
      {children}
    </NohmoContext.Provider>
  )
}

export function useNohmo() {
  return useContext(NohmoContext)
}

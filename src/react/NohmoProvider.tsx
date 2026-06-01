'use client'

import React, { createContext, useContext, useEffect, useRef } from 'react'
import { NohmoTracker } from '../core/tracker'
import type { NohmoConfig } from '../core/types'

interface NohmoContextValue {
  send: (event: string, data?: Record<string, unknown>) => void
  trackConversion: (slug: string, properties?: Record<string, unknown>) => void
  trackTimeSpent: (path?: string) => void
  linkUser: (
    userId: string,
    email?: string,
    meta?: Record<string, unknown>
  ) => Promise<void>
}

const NohmoContext = createContext<NohmoContextValue>({
  send: () => undefined,
  trackConversion: () => undefined,
  trackTimeSpent: () => undefined,
  linkUser: async () => undefined,
})

interface NohmoProviderProps {
  children: React.ReactNode
  projectId: string
  apiKey: string
  options?: Partial<NohmoConfig>
}

export function NohmoProvider({
  children,
  projectId,
  apiKey,
  options = {},
}: NohmoProviderProps) {
  const trackerRef = useRef<NohmoTracker | null>(null)

  // Queue for linkUser calls that arrive before the tracker useEffect has run.
  // This happens when a child component calls linkUser in its own useEffect —
  // React runs child effects before parent effects, so trackerRef.current is
  // still null at that point. We drain this queue once the tracker is ready.
  type PendingLink = [string, string | undefined, Record<string, unknown> | undefined]
  const pendingLinksRef = useRef<PendingLink[]>([])

  useEffect(() => {
    const tracker = new NohmoTracker({
      projectId,
      apiKey,
      ...options,
    })

    trackerRef.current = tracker

    // Drain any linkUser calls that arrived before this effect ran
    const pending = pendingLinksRef.current.splice(0)
    if (pending.length > 0) {
      // tracker.linkUser already awaits initPromise internally, so it's safe
      // to call these right away — they'll wait for init to complete
      for (const [userId, email, meta] of pending) {
        tracker.linkUser(userId, email, meta)
      }
    }

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

  const trackConversion = (slug: string, properties?: Record<string, unknown>) => {
    trackerRef.current?.trackConversion(slug, properties)
  }

  const trackTimeSpent = (path?: string) => {
    trackerRef.current?.trackTimeSpent(path)
  }

  const linkUser = async (
    userId: string,
    email?: string,
    meta?: Record<string, unknown>
  ) => {
    if (!trackerRef.current) {
      // Tracker not yet mounted — queue this call.
      // The useEffect above will drain it once the tracker is initialised.
      pendingLinksRef.current.push([userId, email, meta])
      return
    }
    await trackerRef.current.linkUser(userId, email, meta)
  }

  return (
    <NohmoContext.Provider value={{ send, trackConversion, trackTimeSpent, linkUser }}>
      {children}
    </NohmoContext.Provider>
  )
}

export function useNohmo() {
  return useContext(NohmoContext)
}

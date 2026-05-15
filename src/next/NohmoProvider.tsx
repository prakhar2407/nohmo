'use client'

import React, { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { NohmoProvider, useNohmo } from '../react/NohmoProvider'
import type { NohmoConfig } from '../core/types'

function NohmoNextInner() {
  const { trackTimeSpent, send } = useNohmo()
  const pathname = usePathname()
  const isFirst = useRef(true)
  const prevPath = useRef<string>(pathname)

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      send('PAGE_VIEW', {
        path: pathname,
        title: typeof document !== 'undefined' ? document.title : '',
      })
      return
    }

    trackTimeSpent(prevPath.current)
    send('PAGE_VIEW', {
      path: pathname,
      title: typeof document !== 'undefined' ? document.title : '',
    })
    prevPath.current = pathname
  }, [pathname])

  return null
}

interface NohmoNextProviderProps {
  children: React.ReactNode
  projectId: string
  apiKey: string
  options?: Partial<NohmoConfig>
}

export function NohmoNextProvider({
  children,
  projectId,
  apiKey,
  options = {},
}: NohmoNextProviderProps) {
  return (
    <NohmoProvider
      projectId={projectId}
      apiKey={apiKey}
      options={options}
    >
      <NohmoNextInner />
      {children}
    </NohmoProvider>
  )
}

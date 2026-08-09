'use client'

import React, { useEffect, useRef, useState } from 'react'
import { NohmoProvider, useNohmo } from '../react/NohmoProvider'
import { currentPath, onRouteChange } from '../core/route'
import type { NohmoConfig } from '../core/types'

/**
 * Route tracking for App Router apps.
 *
 * This used to read `usePathname` from 'next/navigation'. It no longer does — that static
 * import sat in the main bundle and made `import 'nohmo'` fail in any app that is not a
 * Next app, which is every Vite and CRA project. The History-based watcher in core/route
 * covers App Router soft navigation identically, and works everywhere else too.
 */
function NohmoNextInner() {
  const { trackTimeSpent, send } = useNohmo()
  const [pathname, setPathname] = useState<string>(() => currentPath())
  const isFirst = useRef(true)
  const prevPath = useRef<string>(pathname)

  useEffect(() => onRouteChange(setPathname), [])

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

import { useEffect, useRef } from 'react'
import { useNohmo } from './NohmoProvider'

export function usePageView(path?: string) {
  const { send } = useNohmo()
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    send('PAGE_VIEW', {
      path: path ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
      title: typeof document !== 'undefined' ? document.title : '',
    })
  }, [path])
}

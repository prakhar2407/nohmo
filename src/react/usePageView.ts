import { useEffect } from 'react'
import { useNohmo } from './NohmoProvider'

export function usePageView(path?: string) {
  const { send } = useNohmo()

  useEffect(() => {
    send('PAGE_VIEW', {
      path: path ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
      title: typeof document !== 'undefined' ? document.title : '',
    })
  }, [path])
}

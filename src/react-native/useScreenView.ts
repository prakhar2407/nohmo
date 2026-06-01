import { useEffect } from 'react'
import { useNohmo } from './NohmoProvider'

export function useScreenView(screenName: string) {
  const { trackScreenView } = useNohmo()
  useEffect(() => {
    trackScreenView(screenName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenName])
}

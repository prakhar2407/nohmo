/**
 * Minimal type stubs for React Native peer dependencies.
 * These are declared here so the SDK builds without installing react-native
 * (a ~50 MB package) as a dev dependency. The consuming RN project provides
 * the real implementations at runtime.
 */

declare module 'react-native' {
  export const Platform: {
    OS: 'ios' | 'android' | 'web' | string
    Version: string | number
  }

  export interface AppStateSubscription {
    remove: () => void
  }

  export const AppState: {
    addEventListener: (
      event: 'change',
      handler: (state: 'active' | 'background' | 'inactive' | string) => void
    ) => AppStateSubscription
  }

  export const Dimensions: {
    get: (dim: 'window' | 'screen') => {
      width: number
      height: number
      scale: number
      fontScale: number
    }
  }

  export const Linking: {
    getInitialURL: () => Promise<string | null>
  }

  export const NativeModules: Record<string, Record<string, unknown>>
}

declare module '@react-native-async-storage/async-storage' {
  const AsyncStorage: {
    getItem:  (key: string) => Promise<string | null>
    setItem:  (key: string, value: string) => Promise<void>
  }
  export default AsyncStorage
}

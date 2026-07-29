import { Api } from '../../preload/index'

declare global {
  interface Window {
    api: Api
  }
  /** App version injected at build time from package.json */
  const __APP_VERSION__: string
}

export const DESKTOP_IPC_CHANNELS = {
  APP_GET_INFO: 'desktop:app:get-info'
} as const

export type DesktopIpcChannel =
  (typeof DESKTOP_IPC_CHANNELS)[keyof typeof DESKTOP_IPC_CHANNELS]

export type DesktopErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_CONNECTED'
  | 'NOT_IMPLEMENTED'
  | 'UNAUTHORIZED_SENDER'
  | 'INTERNAL_ERROR'

export interface DesktopError {
  code: DesktopErrorCode
  message: string
  field?: string
}

export type DesktopResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopError }

export interface AppInfo {
  name: string
  version: string
  isPackaged: boolean
  platform: string
}

export interface DesktopApi {
  app: {
    getInfo(): Promise<DesktopResult<AppInfo>>
  }
}

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}

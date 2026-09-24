import { ipcRenderer } from 'electron'
import {
  DESKTOP_IPC_CHANNELS,
  type AppInfo,
  type DesktopApi,
  type DesktopResult
} from '../shared/desktop-api.contract.js'

export interface IpcInvokeTarget {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

export function createDesktopBridge(customIpc?: IpcInvokeTarget): DesktopApi {
  const ipc = customIpc ?? ipcRenderer

  return Object.freeze({
    app: Object.freeze({
      getInfo: async (): Promise<DesktopResult<AppInfo>> => {
        const result = await ipc.invoke(DESKTOP_IPC_CHANNELS.APP_GET_INFO, {})
        return structuredClone(result as DesktopResult<AppInfo>)
      }
    })
  })
}

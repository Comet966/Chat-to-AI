import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type CancelChatCommand,
  type CancelChatResult,
  type ChatEvent,
  type ElectronChatBridgeApi,
  type StartChatCommand,
  type StartChatResult
} from 'chat-contracts'

const bridgeApi: ElectronChatBridgeApi = {
  start: (command: StartChatCommand): Promise<StartChatResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHAT_STREAM_START, command)
  },
  cancel: (command: CancelChatCommand): Promise<CancelChatResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHAT_STREAM_CANCEL, command)
  },
  onEvent: (listener: (event: ChatEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, chatEvent: ChatEvent): void => {
      listener(chatEvent)
    }
    ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM_EVENT, handler)
    }
  }
}

contextBridge.exposeInMainWorld('debugChatApi', bridgeApi)

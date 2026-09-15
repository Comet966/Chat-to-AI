export const IPC_CHANNELS = {
  CHAT_STREAM_START: 'chat:stream:start',
  CHAT_STREAM_CANCEL: 'chat:stream:cancel',
  CHAT_STREAM_EVENT: 'chat:stream:event'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

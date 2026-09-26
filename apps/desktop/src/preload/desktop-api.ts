import { ipcRenderer } from 'electron'
import {
  DESKTOP_IPC_CHANNELS,
  type AppInfo,
  type DesktopApi,
  type DesktopResult
} from '../shared/desktop-api.contract.js'
import type {
  ConversationSnapshotDto,
  ConversationTurnAcceptedDto,
  DesktopConversationEvent,
  DesktopConversationResult,
  SetCurrentConversationTurnInput,
  StartConversationTurnInput
} from '../shared/conversation.contract.js'
import {
  ConversationSnapshotResultSchema,
  ConversationTurnAcceptedResultSchema,
  ConversationVoidResultSchema,
  DesktopConversationEventSchema
} from '../shared/desktop-api.schemas.js'

export interface IpcInvokeTarget {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void
}

function invalidBridgeResult<T>(): DesktopConversationResult<T> {
  return {
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Desktop service returned an invalid response' }
  }
}

export function createDesktopBridge(customIpc?: IpcInvokeTarget): DesktopApi {
  const ipc = customIpc ?? ipcRenderer

  return Object.freeze({
    app: Object.freeze({
      getInfo: async (): Promise<DesktopResult<AppInfo>> => {
        const result = await ipc.invoke(DESKTOP_IPC_CHANNELS.APP_GET_INFO, {})
        return structuredClone(result as DesktopResult<AppInfo>)
      }
    }),
    conversation: Object.freeze({
      getSnapshot: async (): Promise<DesktopConversationResult<ConversationSnapshotDto>> => {
        const result = await ipc.invoke(DESKTOP_IPC_CHANNELS.CONVERSATION_GET_SNAPSHOT, {})
        const parsed = ConversationSnapshotResultSchema.safeParse(result)
        return parsed.success
          ? structuredClone(parsed.data) as DesktopConversationResult<ConversationSnapshotDto>
          : invalidBridgeResult()
      },
      setCurrentTurn: async (
        input: SetCurrentConversationTurnInput
      ): Promise<DesktopConversationResult<ConversationSnapshotDto>> => {
        const result = await ipc.invoke(DESKTOP_IPC_CHANNELS.CONVERSATION_SET_CURRENT, input)
        const parsed = ConversationSnapshotResultSchema.safeParse(result)
        return parsed.success
          ? structuredClone(parsed.data) as DesktopConversationResult<ConversationSnapshotDto>
          : invalidBridgeResult()
      },
      startTurn: async (
        input: StartConversationTurnInput
      ): Promise<DesktopConversationResult<ConversationTurnAcceptedDto>> => {
        const result = await ipc.invoke(DESKTOP_IPC_CHANNELS.CONVERSATION_START_TURN, input)
        const parsed = ConversationTurnAcceptedResultSchema.safeParse(result)
        return parsed.success
          ? structuredClone(parsed.data) as DesktopConversationResult<ConversationTurnAcceptedDto>
          : invalidBridgeResult()
      },
      cancelTurn: async (): Promise<DesktopConversationResult<void>> => {
        const result = await ipc.invoke(DESKTOP_IPC_CHANNELS.CONVERSATION_CANCEL_TURN, {})
        const parsed = ConversationVoidResultSchema.safeParse(result)
        return parsed.success
          ? structuredClone(parsed.data) as DesktopConversationResult<void>
          : invalidBridgeResult()
      },
      onEvent: (listener: (event: DesktopConversationEvent) => void): (() => void) => {
        const handler = (_event: unknown, payload: unknown): void => {
          const parsed = DesktopConversationEventSchema.safeParse(payload)
          if (parsed.success) listener(structuredClone(parsed.data) as DesktopConversationEvent)
        }
        ipc.on(DESKTOP_IPC_CHANNELS.CONVERSATION_EVENT, handler)
        return () => {
          ipc.removeListener(DESKTOP_IPC_CHANNELS.CONVERSATION_EVENT, handler)
        }
      }
    })
  })
}

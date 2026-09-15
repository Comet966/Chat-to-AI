import type {
  CancelChatCommand,
  CancelChatResult,
  ChatClient,
  ChatEvent,
  ElectronChatBridgeApi,
  StartChatCommand,
  StartChatResult,
  Unsubscribe
} from 'chat-contracts'

declare global {
  interface Window {
    debugChatApi?: ElectronChatBridgeApi
  }
}

export class ElectronChatClient implements ChatClient {
  private readonly bridge: ElectronChatBridgeApi | undefined

  constructor(bridge?: ElectronChatBridgeApi) {
    this.bridge = bridge ?? (typeof window !== 'undefined' ? window.debugChatApi : undefined)
  }

  public async start(command: StartChatCommand): Promise<StartChatResult> {
    if (!this.bridge) {
      return {
        requestId: command.requestId,
        accepted: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Electron IPC bridge (window.debugChatApi) is not available in current environment',
          retryable: false
        }
      }
    }

    return this.bridge.start(command)
  }

  public async cancel(command: CancelChatCommand): Promise<CancelChatResult> {
    if (!this.bridge) {
      return {
        requestId: command.requestId,
        cancelled: false
      }
    }

    return this.bridge.cancel(command)
  }

  public subscribe(listener: (event: ChatEvent) => void): Unsubscribe {
    if (!this.bridge) {
      return () => {}
    }

    return this.bridge.onEvent(listener)
  }
}

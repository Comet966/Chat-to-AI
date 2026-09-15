import type { StartChatCommand, StartChatResult, CancelChatCommand, CancelChatResult } from './chat.commands.js'
import type { ChatEvent } from './chat.events.js'

export type Unsubscribe = () => void

export interface ChatClient {
  start(command: StartChatCommand): Promise<StartChatResult>
  cancel(command: CancelChatCommand): Promise<CancelChatResult>
  subscribe(listener: (event: ChatEvent) => void): Unsubscribe
}

export interface ElectronChatBridgeApi {
  start(command: StartChatCommand): Promise<StartChatResult>
  cancel(command: CancelChatCommand): Promise<CancelChatResult>
  onEvent(listener: (event: ChatEvent) => void): Unsubscribe
}

import type { IpcMainInvokeEvent } from 'electron'

export interface SenderPolicyOptions {
  allowedOrigins: string[]
}

export class SenderPolicy {
  private readonly allowedOrigins: string[]

  constructor(options: SenderPolicyOptions) {
    this.allowedOrigins = options.allowedOrigins
  }

  public isAllowedSender(event: IpcMainInvokeEvent): boolean {
    const frame = event.senderFrame
    if (!frame) {
      return false
    }

    // Must be top-level main frame; reject unknown or nested iframes
    if (frame.parent !== null) {
      return false
    }

    const senderUrl = frame.url
    if (!senderUrl) {
      return false
    }

    try {
      const sender = new URL(senderUrl)
      return this.allowedOrigins.some((allowed) => {
        try {
          const allowedUrl = new URL(allowed)
          if (allowedUrl.protocol === 'file:') {
            return (
              sender.protocol === 'file:' &&
              sender.host === allowedUrl.host &&
              sender.pathname === allowedUrl.pathname
            )
          }
          return sender.origin === allowedUrl.origin
        } catch {
          return false
        }
      })
    } catch {
      return false
    }
  }
}

export interface ServerSentEvent {
  event?: string
  data: string
  id?: string
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncIterable<ServerSentEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  let currentEvent: string | undefined = undefined
  let currentDataLines: string[] = []
  let currentId: string | undefined = undefined

  const dispatch = (): ServerSentEvent | null => {
    if (currentDataLines.length === 0 && currentEvent === undefined && currentId === undefined) {
      return null
    }
    const event: ServerSentEvent = {
      ...(currentEvent !== undefined ? { event: currentEvent } : {}),
      data: currentDataLines.join('\n'),
      ...(currentId !== undefined ? { id: currentId } : {})
    }
    currentEvent = undefined
    currentDataLines = []
    currentId = undefined
    return event
  }

  const processLine = (line: string): ServerSentEvent | null => {
    // Empty line indicates event boundary
    if (line === '') {
      return dispatch()
    }
    // Comment line
    if (line.startsWith(':')) {
      return null
    }

    const colonIndex = line.indexOf(':')
    let field: string
    let value: string

    if (colonIndex === -1) {
      field = line
      value = ''
    } else {
      field = line.slice(0, colonIndex)
      value = line.slice(colonIndex + 1)
      if (value.startsWith(' ')) {
        value = value.slice(1)
      }
    }

    if (field === 'event') {
      currentEvent = value
    } else if (field === 'data') {
      currentDataLines.push(value)
    } else if (field === 'id') {
      currentId = value
    }
    return null
  }

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })

      let lineStart = 0
      for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i]
        if (char === '\r') {
          if (i === buffer.length - 1) {
            // Trailing \r might be part of CRLF in next chunk; wait
            break
          }
          const line = buffer.slice(lineStart, i)
          if (buffer[i + 1] === '\n') {
            i++
          }
          lineStart = i + 1
          const evt = processLine(line)
          if (evt) {
            yield evt
            if (signal?.aborted) return
          }
        } else if (char === '\n') {
          const line = buffer.slice(lineStart, i)
          lineStart = i + 1
          const evt = processLine(line)
          if (evt) {
            yield evt
            if (signal?.aborted) return
          }
        }
      }

      buffer = buffer.slice(lineStart)
    }

    // Flush any remaining decoder bytes
    buffer += decoder.decode()
    if (buffer.length > 0 && !signal?.aborted) {
      let lineStart = 0
      for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i]
        if (char === '\r') {
          const line = buffer.slice(lineStart, i)
          if (i + 1 < buffer.length && buffer[i + 1] === '\n') {
            i++
          }
          lineStart = i + 1
          const evt = processLine(line)
          if (evt) {
            yield evt
            if (signal?.aborted) return
          }
        } else if (char === '\n') {
          const line = buffer.slice(lineStart, i)
          lineStart = i + 1
          const evt = processLine(line)
          if (evt) {
            yield evt
            if (signal?.aborted) return
          }
        }
      }
      if (lineStart < buffer.length) {
        const lastLine = buffer.slice(lineStart)
        const evt = processLine(lastLine)
        if (evt) {
          yield evt
        }
      }
    }

    const finalEvt = dispatch()
    if (finalEvt && !signal?.aborted) {
      yield finalEvt
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // Ignore if reader is closed or already cancelled
    }
    reader.releaseLock()
  }
}

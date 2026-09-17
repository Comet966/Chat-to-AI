export type SessionCommand =
  | { type: 'send'; text: string }
  | { type: 'tree' }
  | { type: 'current' }
  | { type: 'select'; nodeId: string }
  | { type: 'path' }
  | { type: 'leaves' }
  | { type: 'branches' }
  | { type: 'cancel' }
  | { type: 'help' }
  | { type: 'quit' }
  | { type: 'empty' }
  | { type: 'unknown'; raw: string; error: string }

export function parseSessionCommand(line: string): SessionCommand {
  const trimmed = line.trim()
  if (!trimmed) {
    return { type: 'empty' }
  }

  if (trimmed.startsWith('/')) {
    const spaceIdx = trimmed.indexOf(' ')
    const commandName = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase()
    const argument = (spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)).trim()

    switch (commandName) {
      case '/send':
        if (!argument) {
          return {
            type: 'unknown',
            raw: line,
            error: 'Usage: /send <message content>'
          }
        }
        return { type: 'send', text: argument }

      case '/tree':
        return { type: 'tree' }

      case '/current':
        return { type: 'current' }

      case '/select':
        if (!argument) {
          return {
            type: 'unknown',
            raw: line,
            error: 'Usage: /select <node-id>'
          }
        }
        return { type: 'select', nodeId: argument }

      case '/path':
        return { type: 'path' }

      case '/leaves':
        return { type: 'leaves' }

      case '/branches':
        return { type: 'branches' }

      case '/cancel':
        return { type: 'cancel' }

      case '/help':
      case '/?':
        return { type: 'help' }

      case '/quit':
      case '/exit':
      case '/q':
        return { type: 'quit' }

      default:
        return {
          type: 'unknown',
          raw: line,
          error: `Unknown command: ${commandName}. Type /help for available commands.`
        }
    }
  }

  // Regular input text is sent as a message
  return { type: 'send', text: trimmed }
}

export function getSessionHelpText(): string {
  return `Available REPL commands:
  <message text>        Send message continuing from current node
  /send <text>          Equivalent to typing message text directly
  /tree                 Display current conversation tree topology
  /current              Display current node details and context
  /select <node-id>     Switch current active node
  /path                 Display root-to-current conversation path
  /leaves               List all leaf node IDs in the tree
  /branches             List all root-to-leaf branch paths
  /cancel               Cancel current streaming request
  /help                 Show this help text
  /quit, /exit          Exit interactive session
`
}

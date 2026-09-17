import { describe, expect, it } from 'vitest'
import {
  getSessionHelpText,
  parseSessionCommand
} from '../../apps/test-cli/src/session-command.parser.js'

describe('session-command.parser', () => {
  it('should parse empty and whitespace lines as empty command', () => {
    expect(parseSessionCommand('')).toEqual({ type: 'empty' })
    expect(parseSessionCommand('   \t  ')).toEqual({ type: 'empty' })
  })

  it('should parse plain text as send command', () => {
    expect(parseSessionCommand('Hello AI')).toEqual({
      type: 'send',
      text: 'Hello AI'
    })
    expect(parseSessionCommand('  Multi word prompt   ')).toEqual({
      type: 'send',
      text: 'Multi word prompt'
    })
  })

  it('should parse /send command', () => {
    expect(parseSessionCommand('/send Hello world')).toEqual({
      type: 'send',
      text: 'Hello world'
    })
    const invalid = parseSessionCommand('/send')
    expect(invalid.type).toBe('unknown')
  })

  it('should parse /tree, /current, /path, /leaves, /branches', () => {
    expect(parseSessionCommand('/tree')).toEqual({ type: 'tree' })
    expect(parseSessionCommand('/current')).toEqual({ type: 'current' })
    expect(parseSessionCommand('/path')).toEqual({ type: 'path' })
    expect(parseSessionCommand('/leaves')).toEqual({ type: 'leaves' })
    expect(parseSessionCommand('/branches')).toEqual({ type: 'branches' })
  })

  it('should parse /select command with nodeId or error when missing argument', () => {
    expect(parseSessionCommand('/select node-123')).toEqual({
      type: 'select',
      nodeId: 'node-123'
    })
    const missing = parseSessionCommand('/select')
    expect(missing.type).toBe('unknown')
  })

  it('should parse /cancel, /help, /quit, /exit', () => {
    expect(parseSessionCommand('/cancel')).toEqual({ type: 'cancel' })
    expect(parseSessionCommand('/help')).toEqual({ type: 'help' })
    expect(parseSessionCommand('/?')).toEqual({ type: 'help' })
    expect(parseSessionCommand('/quit')).toEqual({ type: 'quit' })
    expect(parseSessionCommand('/exit')).toEqual({ type: 'quit' })
    expect(parseSessionCommand('/q')).toEqual({ type: 'quit' })
  })

  it('should report unknown commands cleanly with help hint', () => {
    const unknown = parseSessionCommand('/unknown_cmd')
    expect(unknown.type).toBe('unknown')
    if (unknown.type === 'unknown') {
      expect(unknown.error).toContain('Unknown command')
      expect(unknown.error).toContain('/help')
    }
  })

  it('should provide comprehensive help text', () => {
    const help = getSessionHelpText()
    expect(help).toContain('/send')
    expect(help).toContain('/tree')
    expect(help).toContain('/select')
    expect(help).toContain('/cancel')
    expect(help).toContain('/quit')
  })
})

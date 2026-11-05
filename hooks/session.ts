// The session section: what the desktop app's session bar shows (the
// environment, the folder, the branch, the connectors, Remote Control), read
// from the app's own MCP servers. Pure: the hooks module calls the servers
// and draws it.

import type { Connector, Remote, SessionView } from '../types'
import { PALETTE } from './words'

// The desktop app's servers and the tools the section calls on them.
export const CONNECTORS_SERVER = 'ccd_connectors'
export const CONNECTORS_TOOL = 'session_connectors_status'
export const SESSIONS_SERVER = 'ccd_session_mgmt'
export const SESSION_TOOL = 'get_session'
export const REMOTE_TOOL = 'set_remote_control'
// Picking a folder (the native picker) and moving the session there.
export const DIRECTORY_SERVER = 'ccd_directory'
export const PICK_TOOL = 'request_directory'
export const MOVE_TOOL = 'change_directory'
// A new tab in the app's Terminal panel.
export const TERMINAL_SERVER = 'terminal'
export const TERMINAL_TOOL = 'open_terminal_tab'

export const NO_SESSION: SessionView = {
  isLoaded: false,
  environment: '',
  cwd: '',
  branch: '',
  connectors: [],
  remote: 'unknown',
  isSwitching: false,
}

const REMOTES: readonly Remote[] = ['on', 'off', 'connecting', 'unavailable']

type Block = { type: string; text?: string }

// The JSON a tool answered in its text blocks; undefined when it is not JSON.
export function jsonOf(content: readonly Block[]): unknown {
  const text = content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// The text a tool answered, for an error message.
export function textOf(content: readonly Block[]): string {
  return content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join(' ')
    .trim()
}

// The session's connectors, as session_connectors_status lists them.
export function parseConnectors(value: unknown): Connector[] | undefined {
  const servers = (value as { servers?: unknown } | undefined)?.servers
  if (!Array.isArray(servers)) return undefined
  return servers
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null && typeof s.name === 'string')
    .map(s => ({
      name: s.name as string,
      status: typeof s.status === 'string' ? s.status : 'unknown',
      ...(typeof s.tool_count === 'number' ? { tools: s.tool_count } : {}),
    }))
}

// Where the session runs and whether Remote Control is on, from get_session.
export function parseSession(value: unknown): { environment: string; remote: Remote; worktree?: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  const state = v.remoteControlState
  const remote: Remote = REMOTES.includes(state as Remote) ? (state as Remote) : v.remoteControlActive === true ? 'on' : 'unknown'
  const worktree = typeof v.worktreePath === 'string' ? v.worktreePath : undefined
  return { environment: v.isRemote === true ? 'Nube' : 'Local', remote, ...(worktree ? { worktree } : {}) }
}

// The state set_remote_control answers, as JSON or as words.
export function parseRemote(content: readonly Block[]): Remote | undefined {
  const json = jsonOf(content) as Record<string, unknown> | string | undefined
  const candidates = [typeof json === 'string' ? json : undefined, typeof json === 'object' && json ? json.state : undefined, typeof json === 'object' && json ? json.remoteControlState : undefined]
  for (const c of candidates) if (REMOTES.includes(c as Remote)) return c as Remote
  const word = /\b(on|off|connecting|unavailable)\b/i.exec(textOf(content))?.[1]?.toLowerCase()
  return REMOTES.includes(word as Remote) ? (word as Remote) : undefined
}

export function connected(view: SessionView): Connector[] {
  return view.connectors.filter(c => c.status === 'connected')
}

export function envLabel(isOpen: boolean): string {
  return `${isOpen ? '▾' : '▸'} Entorno`
}

// The folder a directory tool answered with: a `path` field, else the first
// absolute path in its words. Undefined when the person picked none.
export function pathOf(content: readonly Block[]): string | undefined {
  const json = jsonOf(content) as Record<string, unknown> | undefined
  for (const key of ['path', 'directory', 'granted', 'cwd']) {
    const value = json && typeof json === 'object' ? json[key] : undefined
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const match = /([A-Za-z]:\\[^\s"'`]*|~?\/[^\s"'`]+)/.exec(textOf(content))?.[1]
  return match?.replace(/[.,;:)\]]+$/, '')
}

export function connectorsLabel(isOpen: boolean, view: SessionView): string {
  const count = connected(view).length
  return `${isOpen ? '▾' : '▸'} Conectores${count > 0 ? ` · ${count}` : ''}`
}

// The connectors' dot: red when they could not be read, yellow when one
// needs you (sign-in, failed), green when all are up, gray before loading.
export function connectorsColor(view: SessionView): string {
  if (view.connectorsError) return PALETTE.error
  if (!view.isLoaded) return PALETTE.muted
  if (view.connectors.some(c => c.status === 'needs_auth' || c.status === 'failed')) return PALETTE.waiting
  return PALETTE.done
}

export const REMOTE_WORD: Record<Remote, string> = {
  on: 'activado',
  off: 'desactivado',
  connecting: 'conectando…',
  unavailable: 'no disponible',
  unknown: 'sin leer',
}

export function remoteColor(view: SessionView): string {
  if (view.remoteError) return PALETTE.error
  if (view.remote === 'on') return PALETTE.done
  if (view.remote === 'connecting' || view.isSwitching) return PALETTE.waiting
  if (view.remote === 'unavailable') return PALETTE.error
  return PALETTE.muted
}

// The tools a connector has, in words.
export function toolsLabel(tools: number | undefined): string {
  if (tools === undefined) return ''
  return tools === 1 ? '1 herramienta' : `${tools} herramientas`
}

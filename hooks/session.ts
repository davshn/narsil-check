// The session section: what the desktop app's session bar shows (the
// environment, the folder, the branch, the connectors, Remote Control,
// Auto-fix), read
// from the app's own MCP servers. Pure: the hooks module calls the servers
// and draws it.

import type { Autofix, Connector, Remote, SessionView } from '../types'
import { PALETTE } from './words'

// The desktop app's servers and the tools the section calls on them.
export const CONNECTORS_SERVER = 'ccd_connectors'
export const CONNECTORS_TOOL = 'session_connectors_status'
export const SESSIONS_SERVER = 'ccd_session_mgmt'
export const SESSION_TOOL = 'get_session'
export const REMOTE_TOOL = 'set_remote_control'
// The pull request bound to the session and its CI monitor (Auto-fix).
export const PR_SERVER = 'ccd_pr'
export const PR_TOOL = 'get_status'
export const MONITOR_TOOL = 'set_monitor'
// Picking a folder (the native picker) and moving the session there.
export const DIRECTORY_SERVER = 'ccd_directory'
export const PICK_TOOL = 'request_directory'
export const MOVE_TOOL = 'change_directory'
// A new tab in the app's Terminal panel.
export const TERMINAL_SERVER = 'terminal'
export const TERMINAL_TOOL = 'open_terminal_tab'

export const NO_SESSION: SessionView = {
  isLoaded: false,
  repository: '',
  cwd: '',
  branch: '',
  connectors: [],
  remote: 'unknown',
  isSwitching: false,
  autofix: 'unknown',
  isFixSwitching: false,
}

const REMOTES: readonly Remote[] = ['on', 'off', 'connecting', 'unavailable']

// Whether Auto-fix watches the session's pull request, from ccd_pr's
// get_status: only an open one can be watched, and switching needs its url.
export function parsePr(value: unknown): { autofix: Autofix; prUrl?: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as { bound?: unknown; pr?: { url?: unknown; state?: unknown }; monitor?: { auto_fix?: unknown } }
  const url = v.pr?.url
  if (v.bound !== true || v.pr?.state !== 'open' || typeof url !== 'string') return { autofix: 'none' }
  return { autofix: v.monitor?.auto_fix === true ? 'on' : 'off', prUrl: url }
}

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

// Whether Remote Control is on, and the session's worktree, from get_session.
export function parseSession(value: unknown): { remote: Remote; worktree?: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  const state = v.remoteControlState
  const remote: Remote = REMOTES.includes(state as Remote) ? (state as Remote) : v.remoteControlActive === true ? 'on' : 'unknown'
  const worktree = typeof v.worktreePath === 'string' ? v.worktreePath : undefined
  return { remote, ...(worktree ? { worktree } : {}) }
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

// The web page of a git remote: SSH (`git@host:owner/repo.git`,
// `ssh://git@host:22/owner/repo`) and HTTPS (with or without a user or
// `.git`) alike. Undefined for anything else, a local path among them.
export function webUrlOf(remote: string): string | undefined {
  const url = remote.trim()
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(url)
  if (scp) return `https://${scp[1]}/${scp[2]}`
  const full = /^(?:ssh|git|https?):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url)
  if (full) return `https://${full[1]}/${full[2]}`
  return undefined
}

// How the repository is shown: its address without the scheme.
export function repositoryLabel(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

type Glyph = { knob: string; color: string; word: string }

// A switch, drawn: the knob left and gray when off, right and green when
// on; yellow while it changes or connects.
function glyph(state: string, isSwitching: boolean, words: Record<string, string>): Glyph {
  if (isSwitching) return { knob: '━●━', color: PALETTE.waiting, word: 'cambiando…' }
  if (state === 'on') return { knob: '━━●', color: PALETTE.done, word: words.on }
  if (state === 'connecting') return { knob: '━●━', color: PALETTE.waiting, word: words.connecting }
  return { knob: '●━━', color: PALETTE.muted, word: words[state] }
}

export function switchGlyph(view: SessionView): Glyph {
  return glyph(view.remote, view.isSwitching, REMOTE_WORD)
}

export function fixGlyph(view: SessionView): Glyph {
  return glyph(view.autofix, view.isFixSwitching, FIX_WORD)
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

export const FIX_WORD: Record<Autofix, string> = {
  on: 'activado',
  off: 'desactivado',
  none: 'sin PR abierto',
  unknown: 'sin leer',
}

// A connector's row: its name, then its tools when connected, else its state.
export function connectorLine(c: Connector): string {
  if (c.status !== 'connected') return `${c.name} · ${c.status}`
  return c.tools === undefined ? c.name : `${c.name} · ${toolsLabel(c.tools)}`
}

// The tools a connector has, in words.
export function toolsLabel(tools: number | undefined): string {
  if (tools === undefined) return ''
  return tools === 1 ? '1 herramienta' : `${tools} herramientas`
}

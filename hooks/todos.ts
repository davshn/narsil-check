// The Pendientes section: a to-do list kept per project in an untracked file,
// read when the session starts and on each change. Pure: the hooks module
// reads and writes the file and draws the list.

import type { Task } from '../types'
import { PALETTE } from './words'

// Where a project keeps its list, relative to its root, and the line that
// keeps it out of git through .git/info/exclude (local, never committed).
export const TODO_DIR = '.atl/narsil-check'
export const TODO_FILE = `${TODO_DIR}/pendientes.json`
export const EXCLUDE_LINE = `/${TODO_DIR}/`

// Claude's tools over the list, served by the hooks module.
export const TOOL_LIST = 'todo_list'
export const TOOL_ADD = 'todo_add'
export const TOOL_DONE = 'todo_done'
export const TOOL_TEMPLATE = 'todo_add_to_template'

// The tasks a file holds; a missing, empty or broken file holds none, and an
// entry without a name is dropped.
export function parseTodos(text: string | undefined): Task[] {
  if (!text?.trim()) return []
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  const tasks = (value as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(tasks)) return []
  return tasks
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null && typeof t.name === 'string' && t.name.trim() !== '')
    .map(t => ({
      id: typeof t.id === 'string' && t.id ? t.id : (t.name as string),
      name: (t.name as string).trim(),
      ...(typeof t.content === 'string' && t.content.trim() ? { content: t.content.trim() } : {}),
    }))
}

export function serializeTodos(tasks: readonly Task[]): string {
  return `${JSON.stringify({ version: 1, tasks }, null, 2)}\n`
}

// What the new-task field holds: the name, then after the first colon the
// content. Undefined when there is no name.
export function parseEntry(text: string): { name: string; content?: string } | undefined {
  const at = text.indexOf(':')
  const name = (at < 0 ? text : text.slice(0, at)).trim()
  const content = at < 0 ? '' : text.slice(at + 1).trim()
  if (!name) return undefined
  return content ? { name, content } : { name }
}

export function newTask(name: string, content: string | undefined, now: number, random: number): Task {
  const id = `${now.toString(36)}${Math.floor(random * 36 ** 4).toString(36).padStart(4, '0')}`
  return content?.trim() ? { id, name: name.trim(), content: content.trim() } : { id, name: name.trim() }
}

// The task a reference names: its id, else its name ignoring case.
export function findTask(tasks: readonly Task[], ref: string): Task | undefined {
  const wanted = ref.trim().toLowerCase()
  return tasks.find(t => t.id === ref.trim()) ?? tasks.find(t => t.name.toLowerCase() === wanted)
}

// .git/info/exclude with the list's line added; undefined when it is there.
export function withExclude(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map(l => l.trim())
  if (lines.includes(EXCLUDE_LINE) || lines.includes(TODO_DIR) || lines.includes(`${TODO_DIR}/`)) return undefined
  const base = text === '' || text.endsWith('\n') ? text : `${text}\n`
  return `${base}${EXCLUDE_LINE}\n`
}

// A folder name as a person says it: case, dashes, underscores and spaces aside.
const normal = (name: string) => name.toLowerCase().replace(/[-_\s]/g, '')

// The folders among `names` that a template's name points to: the exact one
// when there is one, else every folder whose name contains it.
export function templateMatches(names: readonly string[], query: string): string[] {
  const wanted = normal(query)
  if (!wanted) return []
  const exact = names.filter(n => normal(n) === wanted)
  return exact.length > 0 ? exact : names.filter(n => normal(n).includes(wanted))
}

// The argument of `/narsil-check template "<text>"`, without its quotes.
export function templateArg(args: string): string | undefined {
  const match = /^\s*template\b\s*(.*)$/is.exec(args)
  if (!match) return undefined
  return (match[1] ?? '').trim().replace(/^["“'](.*)["”']$/s, '$1').trim()
}

// What /narsil-check template asks Claude to do.
export function templatePrompt(text: string): string {
  return [
    `Narsil Check · tarea para una plantilla: «${text}»`,
    '',
    `Crea esa tarea en Pendientes de la plantilla que nombra, con la herramienta mcp__narsil-check__${TOOL_TEMPLATE}: la plantilla es el nombre de su carpeta (está junto a este proyecto) o su ruta absoluta.`,
    'Dale un nombre corto. Si te pido explicar algo (por ejemplo, cómo se hizo una actualización), ponlo en el contenido: qué se cambió y en qué archivos, qué falló y cómo se resolvió, para poder repetirlo en la plantilla.',
    'Si la herramienta no encuentra la plantilla o hay varias candidatas, pregúntame cuál es.',
  ].join('\n')
}

export function todosLabel(isOpen: boolean, count: number): string {
  return `${isOpen ? '▾' : '▸'} Pendientes${count > 0 ? ` · ${count}` : ''}`
}

// Yellow while something waits, gray when the list is empty.
export function todosColor(count: number): string {
  return count > 0 ? PALETTE.waiting : PALETTE.muted
}

// The list as Claude reads it from todo_list.
export function todosText(tasks: readonly Task[]): string {
  if (tasks.length === 0) return 'No pending tasks.'
  return tasks.map(t => `- [${t.id}] ${t.name}${t.content ? `\n  ${t.content.replace(/\n/g, '\n  ')}` : ''}`).join('\n')
}

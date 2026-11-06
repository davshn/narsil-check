// What the pane says, and the order it says it in. Pure: the hooks module
// draws it.

import type { Audit, Explained, Finding, Group, Job, Pr, Scan, Severity, Upgrade } from '../types'
import { SEVERITIES, SEVERITY_TITLE, worstOf } from './osv'
import type { Art } from './narsil-art'

export const PANE = 'narsil-check'
export const TITLE = 'Narsil Check'
export const COMMAND = 'narsil-check'
export const COMMAND_HELP = 'Narsil Check, revisiones del proyecto: upgrade | vulns | template "…"'

// What /narsil-check says to anything but a check it knows.
export function commandHelp(arg: string): string {
  const known =
    '/narsil-check upgrade: las librerías que se pueden actualizar. /narsil-check vulns: las vulnerabilidades conocidas. /narsil-check template "…": una tarea en Pendientes de una plantilla.'
  return arg ? `Narsil Check: no conozco "${arg}". Revisiones: ${known}` : `Narsil Check: revisiones del proyecto. ${known}`
}

// Narsil's palette, so both mods read as one: blue for what is running or
// informs, gray for what rests, yellow for what waits on you, green for
// what is done, red for what failed or blocks.
export const PALETTE = {
  info: '#3B8BFF',
  muted: '#8A90A6',
  waiting: '#F5B400',
  done: '#22B573',
  error: '#F0435A',
} as const

export const GROUPS: { group: Group; label: string; hint: string; color: string }[] = [
  { group: 'expo', label: 'Fuera del SDK de Expo', hint: 'npx expo install --fix', color: PALETTE.info },
  { group: 'blocked', label: 'Bloqueada', hint: 'no se puede subir sola: el motivo está debajo', color: PALETTE.error },
  { group: 'review', label: 'Versión mayor: revisar cambios', hint: 'pueden romper la API', color: PALETTE.waiting },
  { group: 'bump', label: 'Solo subir la versión', hint: 'parche o menor', color: PALETTE.done },
]

// Each severity in Narsil's colors: what blocks is red, what waits yellow,
// what can wait gray.
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: PALETTE.error,
  high: PALETTE.error,
  moderate: PALETTE.waiting,
  low: PALETTE.muted,
  unknown: PALETTE.muted,
}

function vulnCount(audit: Audit): number {
  return audit.status === 'done' ? audit.findings.reduce((n, f) => n + f.vulns.length, 0) : 0
}

// The vulnerabilities toggle: its arrow, its name and, once checked, its count.
export function vulnsLabel(isOpen: boolean, audit: Audit): string {
  const count = vulnCount(audit)
  return `${isOpen ? '▾' : '▸'} Vulnerabilidades${count > 0 ? ` · ${count}` : ''}`
}

// The section's dot: red for critical or high, yellow for moderate, gray for
// low or unrated only, green for none.
export function vulnsColor(audit: Audit): string {
  if (audit.status === 'error') return PALETTE.error
  if (audit.status !== 'done') return PALETTE.muted
  if (audit.findings.length === 0) return PALETTE.done
  return SEVERITY_COLOR[worstOf(audit.findings.flatMap(f => f.vulns))]
}

export function auditSummary(findings: Finding[], checked: number): string {
  if (findings.length === 0) return `Sin vulnerabilidades conocidas · ${checked} paquetes revisados`
  const vulns = findings.flatMap(f => f.vulns)
  const parts = SEVERITIES.map(s => [s, vulns.filter(v => v.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${SEVERITY_TITLE[s].toLowerCase()}${n === 1 ? '' : s === 'unknown' ? '' : 's'}`)
  return `${vulns.length} ${vulns.length === 1 ? 'vulnerabilidad' : 'vulnerabilidades'} en ${findings.length} de ${checked} paquetes · ${parts.join(' · ')}`
}

// The section's toggle: its arrow, its name and, once scanned, its count.
// Baby Narsil standing, as one SVG holding both pictures: the light one, and
// the dark one shown only under a dark color scheme, so the picture follows
// the app's theme with no word from the engine.
// Drawn as tall as Narsil stands in her own band (about 100 px), and given to
// the Svg element too: without a size a surface stretches it to the pane.
export const NARSIL_SIZE = { width: 71, height: 100 }

export function narsilSvg(light: Art, dark: Art, height = NARSIL_SIZE.height): string {
  const box = { width: Math.max(light.width, dark.width), height: Math.max(light.height, dark.height) }
  const image = (art: Art, theme: string) =>
    `<image class="${theme}" href="${art.src}" x="${(box.width - art.width) / 2}" y="${box.height - art.height}" width="${art.width}" height="${art.height}"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.width} ${box.height}" width="${Math.round((box.width * height) / box.height)}" height="${height}">` +
    `<style>.oscuro{display:none}@media (prefers-color-scheme: dark){.claro{display:none}.oscuro{display:inline}}</style>` +
    image(light, 'claro') +
    image(dark, 'oscuro') +
    `</svg>`
  )
}

// A library's row as it reads, which names its button: the jump, then what
// else is known of it.
export function upgradeLine(u: Upgrade, ecosystem: string | undefined, fixes: number): string {
  const fixed = fixes > 0 ? ` · corrige ${fixes === 1 ? '1 vulnerabilidad' : `${fixes} vulnerabilidades`}` : ''
  return `${u.display ?? u.name} ${u.current} → ${u.latest}${u.isDev ? ' · dev' : ''}${ecosystem ? ` · ${ecosystem}` : ''}${fixed}`
}

// A group's toggle inside a section: an upgrade group or a severity, with its count.
export function groupLabel(isOpen: boolean, label: string, count: number): string {
  return `${isOpen ? '▾' : '▸'} ${label} (${count})`
}

export function sectionLabel(isOpen: boolean, scan: Scan): string {
  const count = scan.status === 'done' && scan.upgrades.length > 0 ? ` · ${scan.upgrades.length}` : ''
  return `${isOpen ? '▾' : '▸'} Actualizaciones${count}`
}

// The section's color: what most needs you, as Narsil colors its states.
export function sectionColor(scan: Scan): string {
  if (scan.status === 'error') return PALETTE.error
  if (scan.status !== 'done') return PALETTE.muted
  const groups = new Set(scan.upgrades.map(u => u.group))
  if (groups.has('blocked')) return PALETTE.error
  if (groups.has('review')) return PALETTE.waiting
  if (groups.has('expo')) return PALETTE.info
  return PALETTE.done
}

export function sortUpgrades(list: Upgrade[]): Upgrade[] {
  const rank = (u: Upgrade) => GROUPS.findIndex(g => g.group === u.group)
  return [...list].sort((a, b) => rank(a) - rank(b) || Number(a.isDev) - Number(b.isDev) || a.name.localeCompare(b.name))
}

export function summaryOf(list: Upgrade[], checked: number): string {
  if (list.length === 0) return `Todo al día · ${checked} librerías revisadas`
  const counts = GROUPS.map(g => [g, list.filter(u => u.group === g.group).length] as const).filter(([, n]) => n > 0)
  const word = { bump: 'triviales', review: 'mayores', expo: 'de Expo', blocked: 'bloqueadas' } as const
  const parts = counts.map(([g, n]) => `${n} ${word[g.group]}`)
  return `${list.length} para actualizar de ${checked} · ${parts.join(' · ')}`
}

export function heldNote(held: number): string | undefined {
  if (held === 0) return undefined
  return `${held} ${held === 1 ? 'librería tiene' : 'librerías tienen'} versión nueva en npm, pero el SDK de Expo la fija: se suben con el SDK.`
}

export function failedNote(failed: number): string | undefined {
  if (failed === 0) return undefined
  return `No pude consultar ${failed} ${failed === 1 ? 'librería' : 'librerías'} en el registro.`
}

// What the pane says about an upgrade it ran, or undefined when none ran.
export function jobNote(job: Job): { text: string; color: string } | undefined {
  switch (job.status) {
    case 'running':
      return { text: `Actualizando ${job.count} ${job.count === 1 ? 'librería' : 'librerías'} con ${job.manager}…`, color: PALETTE.waiting }
    case 'failed':
      return { text: job.message, color: PALETTE.error }
    case 'upgraded':
      return { text: `Actualicé ${job.count} ${job.count === 1 ? 'librería' : 'librerías'}. Ejecuta los tests antes de hacer commit.`, color: PALETTE.done }
    default:
      return undefined
  }
}

export function pendingLabel(count: number): string {
  return `Sin commit: ${count} ${count === 1 ? 'librería actualizada' : 'librerías actualizadas'} en package.json`
}

const DIFFICULTY_COLOR = { baja: PALETTE.done, media: PALETTE.waiting, alta: PALETTE.error } as const

// The line under a major upgrade: Haiku's reason, or that it is reading.
export function reasonLine(why: Explained | undefined): { text: string; color?: string; isDim: boolean } | undefined {
  if (!why) return undefined
  switch (why.status) {
    case 'loading':
      return { text: 'Analizando con Haiku…', isDim: true }
    case 'failed':
      return { text: why.text, isDim: true }
    default:
      return { text: `Dificultad ${why.difficulty}: ${why.text}`, color: DIFFICULTY_COLOR[why.difficulty], isDim: false }
  }
}

// The button's words: a work branch gets a commit and a push, the default
// branch a new branch and a PR.
export function publishLabel(branch: string, isMain: boolean): string {
  return isMain || !branch ? 'Crear rama, commit y PR' : `Commit y push a ${branch}`
}

// What the pane says about the PR it is making or made.
export function prNote(pr: Pr): { text: string; color: string } | undefined {
  switch (pr.status) {
    case 'running':
      return { text: `${pr.step}…`, color: PALETTE.waiting }
    case 'failed':
      return { text: `No pude crear el PR. ${pr.message}`, color: PALETTE.error }
    case 'done':
      return pr.url
        ? { text: `PR creado desde la rama ${pr.branch}. Sigues en esa rama.`, color: PALETTE.done }
        : { text: `Commit subido a la rama ${pr.branch}.`, color: PALETTE.done }
    default:
      return undefined
  }
}

// What a successful git pull -r did, in a few words: up to date, rebased,
// a fast-forward, or its last line.
export function pullSummary(stdout: string): string {
  if (/up.to.date/i.test(stdout)) return 'ya estaba al día'
  if (/Successfully rebased/i.test(stdout)) return 'rebase hecho'
  if (/Fast-forward/.test(stdout)) return 'Fast-forward'
  return tail(stdout, 1) || 'hecho'
}

// The last lines of a command's output: where its error usually is.

export function tail(text: string, lines = 4): string {
  return text.trim().split(/\r?\n/).slice(-lines).join(' ').slice(0, 400)
}

export function agoLabel(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'revisado ahora'
  if (minutes < 60) return `revisado hace ${minutes} min`
  return `revisado hace ${Math.round(minutes / 60)} h`
}

// Runs `fn` over `items` with at most `limit` at once, keeping their order.
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

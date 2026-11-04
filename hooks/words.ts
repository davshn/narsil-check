// What the pane says, and the order it says it in. Pure: the hooks module
// draws it.

import type { Explained, Group, Job, Pr, Upgrade } from '../types'

export const PANE = 'upgrades'
export const TITLE = 'Actualizaciones'
export const COMMAND = 'upgrades'

export const GROUPS: { group: Group; label: string; hint: string; color: string }[] = [
  { group: 'expo', label: 'Fuera del SDK de Expo', hint: 'npx expo install --fix', color: 'red' },
  { group: 'blocked', label: 'Bloqueada por otras dependencias', hint: 'no se puede subir sola: primero lo que la bloquea', color: 'magenta' },
  { group: 'review', label: 'Versión mayor: revisar cambios', hint: 'pueden romper la API', color: 'yellow' },
  { group: 'bump', label: 'Solo subir la versión', hint: 'parche o menor', color: 'green' },
]

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
      return { text: `Actualizando ${job.count} ${job.count === 1 ? 'librería' : 'librerías'} con ${job.manager}…`, color: 'yellow' }
    case 'failed':
      return { text: job.message, color: 'red' }
    case 'upgraded':
      return { text: `Actualicé ${job.count} ${job.count === 1 ? 'librería' : 'librerías'}. Ejecuta los tests antes de hacer commit.`, color: 'green' }
    default:
      return undefined
  }
}

export function pendingLabel(count: number): string {
  return `Sin commit: ${count} ${count === 1 ? 'librería actualizada' : 'librerías actualizadas'} en package.json`
}

const DIFFICULTY_COLOR = { baja: 'green', media: 'yellow', alta: 'red' } as const

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
      return { text: `${pr.step}…`, color: 'yellow' }
    case 'failed':
      return { text: `No pude crear el PR. ${pr.message}`, color: 'red' }
    case 'done':
      return pr.url
        ? { text: `PR creado desde la rama ${pr.branch}. Sigues en esa rama.`, color: 'green' }
        : { text: `Commit subido a la rama ${pr.branch}.`, color: 'green' }
    default:
      return undefined
  }
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

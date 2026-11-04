// Why a major upgrade is not a plain bump: the release notes of the versions
// that break, how the project uses the library, and Haiku's reading of both.
// Pure functions over plain values: the hooks module fetches, greps and asks.

import type { Difficulty, Upgrade } from '../types'
import { parseVersion } from './semver'

export type Reason = { difficulty: Difficulty; text: string }

// The key a reason is cached and shown under: one per jump.
export function reasonKey(u: Pick<Upgrade, 'name' | 'current' | 'latest'>): string {
  return `${u.name}@${u.current}->${u.latest}`
}

// The GitHub repository npm records for a package, from its manifest.
export function repoOf(manifest: unknown): { owner: string; repo: string } | undefined {
  const field = (manifest as { repository?: unknown } | undefined)?.repository
  const url = typeof field === 'string' ? field : (field as { url?: unknown } | undefined)?.url
  if (typeof url !== 'string') return undefined
  const m = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[/#].*)?$/.exec(url) ?? /^(?:github:)?([^/:]+)\/([^/]+)$/.exec(url)
  return m ? { owner: m[1] as string, repo: m[2] as string } : undefined
}

// The releases that break between two versions, newest first and at most
// three: each new major's x.0.0, or below 1.0.0 each new minor's 0.y.0.
export function breakingVersions(current: string, latest: string): string[] {
  const from = parseVersion(current)
  const to = parseVersion(latest)
  if (!from || !to) return []
  const list: string[] = []
  if (to.major > from.major) for (let m = from.major + 1; m <= to.major; m++) list.push(`${m}.0.0`)
  else if (from.major === 0 && to.minor > from.minor) for (let n = from.minor + 1; n <= to.minor; n++) list.push(`0.${n}.0`)
  else list.push(latest)
  return list.reverse().slice(0, 3)
}

// The tags a release of `version` is published under: a single package's
// "v19.0.0", a monorepo's "@scope/name@19.0.0", or the bare version.
export function releaseTags(name: string, version: string): string[] {
  return [`v${version}`, `${name}@${version}`, version]
}

export function releaseUrl(owner: string, repo: string, tag: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`
}

export function changelogUrl(name: string, version: string): string {
  return `https://unpkg.com/${name}@${version}/CHANGELOG.md`
}

// A CHANGELOG, newest first, cut where the installed version's entry
// begins: what changed since.
export function changelogSince(text: string, current: string): string {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex(l => /^#{1,4}\s/.test(l) && l.includes(current))
  return (at > 0 ? lines.slice(0, at) : lines).join('\n')
}

// Most of each release's notes, so a long upgrade guide still leaves room.
export const NOTES_PER_RELEASE = 6000
export const NOTES_TOTAL = 12_000

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…]` : text
}

// An extended regex for the project's imports of `name`, for git grep:
// `from 'name'`, `from 'name/sub'`, `require('name')` and `import('name')`.
export function importPattern(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `(from[[:space:]]+|require\\(|import\\()['"]${escaped}(/[^'"]*)?['"]`
}

export const SYSTEM = [
  'You assess how hard a major dependency upgrade is for one specific project.',
  'You get the release notes of the breaking versions and the lines where the project imports the library.',
  'Answer in Spanish, in exactly this form:',
  'DIFICULTAD: baja|media|alta',
  'RAZÓN: one or two sentences, at most 280 characters, naming the concrete breaking change that affects the imports shown, or saying none of them is touched.',
  'Base the answer only on what you are given. Never invent APIs, versions or changes.',
  'If the release notes are missing, say so in the reason and judge only from how much the project uses the library.',
].join('\n')

export function prompt(u: Pick<Upgrade, 'name' | 'current' | 'latest'>, notes: string, usage: { files: number; lines: string[] }): string {
  return [
    `Library: ${u.name}`,
    `Upgrade: ${u.current} -> ${u.latest}`,
    '',
    `The project imports it in ${usage.files} ${usage.files === 1 ? 'file' : 'files'}:`,
    usage.lines.length > 0 ? usage.lines.join('\n') : '(no imports found: it may be used through config or a CLI)',
    '',
    'Release notes of the breaking versions:',
    notes.trim() || '(none found)',
  ].join('\n')
}

export function parseReason(text: string): Reason | undefined {
  const difficulty = /DIFICULTAD:\s*(baja|media|alta)/i.exec(text)?.[1]?.toLowerCase()
  const reason = /RAZ[ÓO]N:\s*([\s\S]+)/i.exec(text)?.[1]?.trim()
  if (!difficulty || !reason) return undefined
  return { difficulty: difficulty as Difficulty, text: reason.replace(/\s+/g, ' ').slice(0, 400) }
}

// What the copy button puts on the clipboard: each blocked upgrade with what
// blocks it, and each major with its reason, ready to paste into an issue or
// a prompt.
export function copyText(rows: Upgrade[], reasons: Record<string, Reason | undefined>): string {
  const blocked = rows.filter(u => u.group === 'blocked')
  const majors = rows.filter(u => u.group === 'review')
  const lines: string[] = []
  if (blocked.length > 0) {
    lines.push('Librerías bloqueadas por otras dependencias:')
    for (const u of blocked) lines.push(`- ${u.display ?? u.name} ${u.current} → ${u.latest}: ${u.conflicts.join('; ')}`)
  }
  if (majors.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('Librerías con versión mayor pendiente:')
    for (const u of majors) {
      const r = reasons[reasonKey(u)]
      lines.push(`- ${u.display ?? u.name} ${u.current} → ${u.latest}${r ? ` (dificultad ${r.difficulty}): ${r.text}` : ''}`)
    }
  }
  return lines.join('\n')
}

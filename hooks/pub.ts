// Dart and Flutter's Pub: what pubspec.yaml declares, what pubspec.lock says
// is installed, pub.dev's latest release, and how the bump group goes up.
// The YAML read here is the part these files use: top-level sections and
// their two-space entries, by indentation.

import type { Upgrade } from '../types'
import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex } from './adapter'

const MANIFEST = 'pubspec.yaml'
const LOCK = 'pubspec.lock'
const SECTIONS: Record<string, boolean> = { dependencies: false, dev_dependencies: true }

type Line = { indent: number; key: string; value: string }

// Each `key: value` line with its indentation, comments and blank lines left
// out, quotes taken off the value.
function linesOf(text: string): Line[] {
  const out: Line[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const m = /^(\s*)([^:#\s][^:#]*?)\s*:\s*(.*?)\s*(?:\s#.*)?$/.exec(raw)
    if (!m) continue
    out.push({ indent: (m[1] as string).length, key: (m[2] as string).replace(/^["']|["']$/g, ''), value: (m[3] as string).replace(/^["']|["']$/g, '') })
  }
  return out
}

// The entries under each top-level section, with their nested fields:
// `http: ^1.2.0` is { http: { '': '^1.2.0' } }; `flutter:\n  sdk: flutter`
// is { flutter: { sdk: 'flutter' } }.
function sectionsOf(text: string): Record<string, Record<string, Record<string, string>>> {
  const sections: Record<string, Record<string, Record<string, string>>> = {}
  let section: string | undefined
  let entry: string | undefined
  let entryIndent = 0
  for (const l of linesOf(text)) {
    if (l.indent === 0) {
      section = l.key
      sections[section] = {}
      entry = undefined
      continue
    }
    if (!section) continue
    const own = sections[section] as Record<string, Record<string, string>>
    if (entry === undefined || l.indent <= entryIndent) {
      entry = l.key
      entryIndent = l.indent
      own[entry] = l.value ? { '': l.value } : {}
    } else {
      ;(own[entry] as Record<string, string>)[l.key] = l.value
    }
  }
  return sections
}

export function parsePub(files: Files): Dep[] {
  const text = files[MANIFEST]
  if (text === undefined) return []
  const manifest = sectionsOf(text)
  const locked = new Map<string, string>()
  if (files[LOCK] !== undefined) {
    for (const [name, fields] of Object.entries(sectionsOf(files[LOCK]).packages ?? {})) {
      if (fields.version) locked.set(name, fields.version)
    }
  }
  const deps: Dep[] = []
  for (const [section, isDev] of Object.entries(SECTIONS)) {
    for (const [name, fields] of Object.entries(manifest[section] ?? {})) {
      // An SDK, path or git dependency is not pub.dev's.
      if (fields.sdk !== undefined || fields.path !== undefined || fields.git !== undefined) continue
      const spec = fields[''] ?? fields.version ?? 'any'
      if (!deps.some(d => d.name === name)) deps.push({ name, spec, isDev, installed: locked.get(name) })
    }
  }
  return deps
}

export function isFlutter(files: Files): boolean {
  const text = files[MANIFEST]
  return text !== undefined && sectionsOf(text).dependencies?.flutter?.sdk === 'flutter'
}

// The constraint written back: the same operator, the new version, and an
// upper bound kept: "^1.1.0" -> "^1.6.0", ">=1.0.0 <2.0.0" -> ">=1.6.0 <2.0.0".
export function pubSpecFor(spec: string, latest: string): string {
  return /\d/.test(spec) ? spec.replace(/^(\^|>=|>|=)?\s*[0-9][0-9A-Za-z.+-]*/, `$1${latest}`) : spec
}

// pubspec.yaml with each upgrade's constraint raised, every other byte as it
// was: `  http: ^1.1.0` and a nested `    version: ^1.1.0`.
export function rewritePub(text: string, upgrades: Upgrade[]): string {
  const lines = text.split('\n')
  let section = ''
  let entry = ''
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] as string
    const top = /^([A-Za-z_][\w]*)\s*:/.exec(line)
    if (top) {
      section = top[1] as string
      entry = ''
      continue
    }
    if (!(section in SECTIONS)) continue
    const own = /^(\s{2})([A-Za-z_][\w]*)(\s*:\s*)(["']?)([^"'\s#]*)(\4)(.*)$/.exec(line.replace(/\r$/, ''))
    if (own) {
      entry = own[2] as string
      const u = upgrades.find(x => x.name === entry)
      if (u && own[5]) lines[n] = `${own[1]}${entry}${own[3]}${own[4]}${pubSpecFor(own[5] as string, u.latest)}${own[6]}${own[7]}${line.endsWith('\r') ? '\r' : ''}`
      continue
    }
    const nested = /^(\s{4,}version\s*:\s*)(["']?)([^"'#]*?)(\2)(\s*(?:#.*)?)$/.exec(line.replace(/\r$/, ''))
    const u = upgrades.find(x => x.name === entry)
    if (nested && u) lines[n] = `${nested[1]}${nested[2]}${pubSpecFor(nested[3] as string, u.latest)}${nested[4]}${nested[5]}${line.endsWith('\r') ? '\r' : ''}`
  }
  return lines.join('\n')
}

export const PUB: Adapter = {
  id: 'pub',
  label: 'Pub',
  manifests: [MANIFEST],
  lockfiles: [LOCK],
  parse: parsePub,
  latestUrl: name => `https://pub.dev/api/packages/${encodeURIComponent(name)}`,
  headers: { accept: 'application/json' },
  latestOf: text => {
    const version = (JSON.parse(text) as { latest?: { version?: unknown } }).latest?.version
    return typeof version === 'string' ? version : undefined
  },
  rewrite: (files, upgrades): Files => {
    const text = files[MANIFEST]
    return text === undefined ? {} : { [MANIFEST]: rewritePub(text, upgrades) }
  },
  // pubspec.lock follows the raised constraints; a Flutter app gets them
  // through flutter, which brings its own Dart.
  installArgv: (_, __, files) => [[isFlutter(files) ? 'flutter' : 'dart', 'pub', 'get']],
  managerOf: () => 'pub',
  importPattern: name => `['"]package:${escapeRegex(name)}/`,
  repoUrlOf: text => {
    const pubspec = (JSON.parse(text) as { latest?: { pubspec?: { repository?: unknown; homepage?: unknown } } }).latest?.pubspec
    const urls = [pubspec?.repository, pubspec?.homepage].filter((u): u is string => typeof u === 'string')
    return urls.find(u => u.includes('github.com'))
  },
}

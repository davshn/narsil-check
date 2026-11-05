// Rust's Cargo: what Cargo.toml declares, what Cargo.lock says is
// installed, crates.io's latest release, and how the bump group goes up.

import type { Upgrade } from '../types'
import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex } from './adapter'
import { parseVersion, satisfies } from './semver'
import { parseToml, tableOf } from './toml'
import type { TomlTable, TomlValue } from './toml'

const MANIFEST = 'Cargo.toml'
const LOCK = 'Cargo.lock'
const SECTIONS: [string, boolean][] = [
  ['dependencies', false],
  ['dev-dependencies', true],
  ['build-dependencies', true],
]

// A Cargo requirement as an npm-style range: a bare "1.2" means "^1.2".
export function cargoRange(spec: string): string {
  return spec
    .split(',')
    .map(part => part.trim())
    .map(part => (/^\d/.test(part) ? `^${part}` : part))
    .join(' ')
}

// One entry of a dependency table: its crate name and requirement, or
// undefined for what crates.io does not serve (a path, a git source, the
// workspace's own).
function entryOf(key: string, value: TomlValue): { name: string; spec: string } | undefined {
  if (typeof value === 'string') return { name: key, spec: value }
  const t = tableOf(value)
  if (!t || typeof t.version !== 'string' || t.path !== undefined || t.git !== undefined) return undefined
  return { name: typeof t.package === 'string' ? t.package : key, spec: t.version }
}

function tablesOf(manifest: TomlTable): [TomlTable, boolean][] {
  const found: [TomlTable, boolean][] = []
  for (const [section, isDev] of SECTIONS) {
    const own = tableOf(manifest[section])
    if (own) found.push([own, isDev])
    // [target.'cfg(windows)'.dependencies] and the like.
    for (const target of Object.values(tableOf(manifest.target) ?? {})) {
      const nested = tableOf(tableOf(target)?.[section])
      if (nested) found.push([nested, isDev])
    }
  }
  return found
}

export function parseCargo(files: Files): Dep[] {
  const text = files[MANIFEST]
  if (text === undefined) return []
  const manifest = parseToml(text)
  const locked = new Map<string, string[]>()
  try {
    const lock = files[LOCK] ? parseToml(files[LOCK]) : {}
    for (const p of (Array.isArray(lock.package) ? lock.package : []) as TomlValue[]) {
      const t = tableOf(p)
      if (t && typeof t.name === 'string' && typeof t.version === 'string') locked.set(t.name, [...(locked.get(t.name) ?? []), t.version])
    }
  } catch {
    // An unreadable lockfile: versions come from the requirements.
  }
  const deps: Dep[] = []
  for (const [table, isDev] of tablesOf(manifest)) {
    for (const [key, value] of Object.entries(table)) {
      const entry = entryOf(key, value)
      if (!entry || deps.some(d => d.name === entry.name)) continue
      // Cargo.lock may hold several versions of a crate: the one this
      // requirement resolved to.
      const range = cargoRange(entry.spec)
      const installed = (locked.get(entry.name) ?? []).find(v => {
        const parsed = parseVersion(v)
        return parsed !== undefined && satisfies(parsed, range)
      })
      deps.push({ name: entry.name, spec: entry.spec, isDev, installed })
    }
  }
  return deps
}

// The requirement written back: the same operator as before, the new version.
export function cargoSpecFor(spec: string, latest: string): string {
  const op = /^\s*(\^|~|=|>=)?/.exec(spec)?.[1] ?? ''
  return `${op}${latest}`
}

// Cargo.toml with each upgrade's requirement raised, every other byte as it
// was: `name = "1.0"`, `name = { version = "1.0", ... }` and a
// `[dependencies.name]` table's `version = "1.0"`.
export function rewriteCargo(text: string, upgrades: Upgrade[]): string {
  const lines = text.split('\n')
  let header = ''
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] as string
    const head = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(line)
    if (head) {
      header = (head[1] as string).replace(/\s/g, '')
      continue
    }
    for (const u of upgrades) {
      const key = escapeRegex(u.name)
      const inSection = /(^|\.)(dev-|build-)?dependencies$/.test(header)
      const inOwnTable = new RegExp(`(^|\\.)(dev-|build-)?dependencies\\.("?)${key}\\3$`).test(header)
      const swap = (_: string, before: string, spec: string, after: string) => `${before}${cargoSpecFor(spec, u.latest)}${after}`
      const line = lines[n] as string
      if (inSection) {
        lines[n] = line
          .replace(new RegExp(`^(\\s*"?${key}"?\\s*=\\s*")([^"]+)(")`), swap)
          .replace(new RegExp(`^(\\s*"?${key}"?\\s*=\\s*\\{[^}]*\\bversion\\s*=\\s*")([^"]+)(")`), swap)
      } else if (inOwnTable) {
        lines[n] = line.replace(/^(\s*version\s*=\s*")([^"]+)(")/, swap)
      }
    }
  }
  return lines.join('\n')
}

export const CARGO: Adapter = {
  id: 'cargo',
  label: 'Cargo',
  manifests: [MANIFEST],
  lockfiles: [LOCK],
  parse: parseCargo,
  latestUrl: name => `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
  // crates.io refuses a request with no User-Agent.
  headers: { accept: 'application/json', 'user-agent': 'narsil-check (https://github.com/davshn/narsil-check)' },
  latestOf: text => {
    const crate = (JSON.parse(text) as { crate?: { max_stable_version?: unknown; max_version?: unknown } }).crate
    const version = crate?.max_stable_version ?? crate?.max_version
    return typeof version === 'string' ? version : undefined
  },
  rewrite: (files, upgrades): Files => {
    const text = files[MANIFEST]
    return text === undefined ? {} : { [MANIFEST]: rewriteCargo(text, upgrades) }
  },
  // Cargo.lock follows the raised requirements.
  installArgv: (_, upgrades) => [['cargo', 'update', ...upgrades.flatMap(u => ['-p', u.name])]],
  managerOf: () => 'cargo',
  // Cargo.lock's crates from crates.io (a path or git crate is the project's own).
  treeOf: files => {
    try {
      const lock = parseToml(files[LOCK] ?? '')
      return ((Array.isArray(lock.package) ? lock.package : []) as TomlValue[])
        .map(p => tableOf(p))
        .filter((t): t is TomlTable => !!t && typeof t.name === 'string' && typeof t.version === 'string' && typeof t.source === 'string' && t.source.startsWith('registry+'))
        .map(t => ({ name: t.name as string, version: t.version as string }))
    } catch {
      return []
    }
  },
  // A crate is named with _ in code: `use serde_json::...`, `serde_json::from_str`.
  importPattern: name => {
    const ident = escapeRegex(name.replace(/-/g, '_'))
    return `(extern crate[[:space:]]+${ident}|(^|[^[:alnum:]_])${ident}::)`
  },
  repoUrlOf: text => {
    const repo = (JSON.parse(text) as { crate?: { repository?: unknown } }).crate?.repository
    return typeof repo === 'string' ? repo : undefined
  },
}

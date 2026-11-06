// The npm ecosystem (JavaScript and TypeScript) and Expo on top of it: what
// package.json declares, what is installed, where the registry answers and
// how each dependency is grouped. Pure functions over plain values: the
// hooks module reads the files and fetches.

import type { Upgrade } from '../types'
import { baseOf, bumpOf, parseVersion, satisfies, show } from './semver'
import type { Version } from './semver'

export type Declared = { name: string; spec: string; isDev: boolean }

export const MANIFEST = 'package.json'
export const LOCK = 'package-lock.json'

export function parseManifest(text: string): Declared[] {
  const json = JSON.parse(text) as Record<string, unknown>
  const list: Declared[] = []
  for (const [field, isDev] of [['dependencies', false], ['devDependencies', true]] as const) {
    const deps = json[field]
    if (!deps || typeof deps !== 'object') continue
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec === 'string' && !list.some(d => d.name === name)) list.push({ name, spec, isDev })
    }
  }
  return list
}

// The installed version as package-lock.json (v2 and v3) records it.
export function lockedVersion(lock: unknown, name: string): string | undefined {
  const packages = (lock as { packages?: Record<string, { version?: unknown }> } | undefined)?.packages
  const version = packages?.[`node_modules/${name}`]?.version
  return typeof version === 'string' ? version : undefined
}

// The registry's latest release of one package: a small document, unlike the
// package's full record. A scoped name keeps its @ and escapes its slash.
export function latestUrl(name: string): string {
  return `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`
}

export function latestOf(text: string): string | undefined {
  const version = (JSON.parse(text) as { version?: unknown }).version
  return typeof version === 'string' ? version : undefined
}

// Expo pins the native modules each SDK is built against; installing a newer
// one than its table allows breaks the build, so the table wins over npm.
export const EXPO_TABLE = 'node_modules/expo/bundledNativeModules.json'
export function expoTableUrl(expoVersion: string): string {
  return `https://unpkg.com/expo@${expoVersion}/bundledNativeModules.json`
}

export type Found = { declared: Declared; installed: Version; latest?: Version }

// What one dependency needs, or undefined when it is current. `expo` is the
// SDK's table when the project is an Expo app.
export function upgradeOf(found: Found, expo?: Record<string, string>): Upgrade | 'held' | undefined {
  const { declared, installed, latest } = found
  const base = { name: declared.name, ecosystem: 'npm' as const, spec: declared.spec, current: show(installed), isDev: declared.isDev }
  const range = declared.name === 'expo' ? undefined : expo?.[declared.name]
  if (range !== undefined) {
    if (!satisfies(installed, range)) {
      const target = baseOf(range)
      const jump = target ? bumpOf(installed, target) : 'none'
      // 'none' is a downgrade back into the range: shown as a minor change.
      return { ...base, latest: range, bump: jump === 'none' ? 'minor' : jump, group: 'expo', conflicts: [] }
    }
    // Within the SDK's range: anything newer on npm is not this SDK's to take.
    return latest && bumpOf(installed, latest) !== 'none' ? 'held' : undefined
  }
  if (!latest) return undefined
  const bump = bumpOf(installed, latest)
  if (bump === 'none') return undefined
  return { ...base, latest: show(latest), bump, group: bump === 'major' ? 'review' : 'bump', conflicts: [] }
}

// A range that names one version and nothing else: "8.71.0", "=8.71.0".
// Families published together (typescript-eslint, @babel/*, @angular/*) pin
// their siblings this way.
export function isExactPin(range: string): boolean {
  return /^=?v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range.trim())
}

// Why `name` at `target` would leave two copies installed: an installed
// package, anywhere in the tree package-lock.json (v2 and v3) records, pins
// `name` to an exact version the new one is not. npm then keeps the pinned
// copy nested under it, and a plugin loaded twice (ESLint's "Cannot
// redefine plugin") or two copies of a singleton break the project. A range
// that is not an exact pin is left alone: a nested copy there is usually
// harmless.
//
// `batch` is what goes up together (name -> new version). A family moving
// in lockstep pins its siblings to its own version, so a pin is carried
// along when its owner goes up to the same version in the batch
// (@tailwindcss/vite 4.3.3 -> 4.3.4 with tailwindcss), or when a carried
// package pins the owner in lockstep (@tailwindcss/vite pins
// @tailwindcss/node, which pins tailwindcss): then one copy stays.
export function pinConflicts(name: string, target: Version, lock: unknown, batch: Map<string, string> = new Map()): string[] {
  const packages = (lock as { packages?: Record<string, unknown> } | undefined)?.packages
  if (!packages || typeof packages !== 'object') return []
  type Entry = { version?: unknown; dependencies?: Record<string, unknown>; optionalDependencies?: Record<string, unknown> }
  const entryOf = (path: string) => (packages[path] ?? {}) as Entry
  const depOf = (e: Entry, dep: string) => e.dependencies?.[dep] ?? e.optionalDependencies?.[dep]
  const goal = show(target)
  // The top-level packages that follow the batch to `goal`.
  const carried = new Set<string>()
  for (const [pkg, version] of batch) if (version === goal) carried.add(pkg)
  for (let grew = true; grew; ) {
    grew = false
    for (const path of Object.keys(packages)) {
      if (!path.startsWith('node_modules/') || path.lastIndexOf('node_modules/') !== 0) continue
      const pkg = path.slice('node_modules/'.length)
      const own = entryOf(path).version
      if (carried.has(pkg) || typeof own !== 'string') continue
      const pinnedByCarried = [...carried].some(c => depOf(entryOf(`node_modules/${c}`), pkg) === own)
      if (pinnedByCarried) {
        carried.add(pkg)
        grew = true
      }
    }
  }
  const conflicts: string[] = []
  const seen = new Set<string>()
  for (const [path, entry] of Object.entries(packages)) {
    if (!path.includes('node_modules/')) continue
    const owner = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (owner === name) continue
    const e = (entry ?? {}) as Entry
    const range = depOf(e, name)
    if (typeof range !== 'string' || !isExactPin(range) || satisfies(target, range)) continue
    // A lockstep owner the batch carries pins the new version once it goes up.
    if (carried.has(owner) && range.replace(/^=?v?/, '') === e.version) continue
    const label = `${owner}${typeof e.version === 'string' ? ` ${e.version}` : ''}`
    if (seen.has(label)) continue
    seen.add(label)
    conflicts.push(`${label} fija ${name} ${range}: quedarían dos copias`)
  }
  return conflicts
}

// An installed package as peer checks need it: its version and the peers it
// asks for, with the optional ones apart.
export type Installed = { version: Version; peers: Record<string, string>; optional: string[] }

export function installedFromManifest(manifest: unknown, version: Version): Installed {
  const m = (manifest ?? {}) as { peerDependencies?: unknown; peerDependenciesMeta?: unknown }
  const peers: Record<string, string> = {}
  if (m.peerDependencies && typeof m.peerDependencies === 'object') {
    for (const [name, range] of Object.entries(m.peerDependencies as Record<string, unknown>)) if (typeof range === 'string') peers[name] = range
  }
  const meta = (m.peerDependenciesMeta ?? {}) as Record<string, { optional?: unknown }>
  const optional = Object.keys(meta).filter(name => meta[name]?.optional === true)
  return { version, peers, optional }
}

// The registry's manifest of one version, where its peers are written.
export function versionUrl(name: string, version: string): string {
  return `https://registry.npmjs.org/${name.replace('/', '%2F')}/${version}`
}

// Why `name` cannot go to `target` alone, both ways:
// - the new version asks for a peer the project has at a version outside
//   its range ("eslint-plugin-astro 3.2.1 necesita eslint >=10.0.0");
// - an installed package asks for `name` in a range the new version leaves
//   ("eslint-config-love exige eslint ^9.35.0").
// A peer the project does not have is npm's to add, not a conflict.
export function peerConflicts(name: string, target: Installed, installed: Map<string, Installed>): string[] {
  const conflicts: string[] = []
  for (const [peer, range] of Object.entries(target.peers)) {
    const have = installed.get(peer)
    if (have && !satisfies(have.version, range)) conflicts.push(`${name} ${show(target.version)} necesita ${peer} ${range} (tienes ${show(have.version)})`)
  }
  for (const [other, have] of installed) {
    if (other === name) continue
    const range = have.peers[name]
    if (range && !satisfies(target.version, range)) conflicts.push(`${other} exige ${name} ${range}`)
  }
  return conflicts
}

export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun'

// The lockfile that names each package manager, the first found winning.
export const LOCKFILES: [string, Manager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]

export function managerOf(present: string[]): Manager {
  return LOCKFILES.find(([file]) => present.includes(file))?.[1] ?? 'npm'
}

// The range written back to package.json: the same prefix as before, so a
// "^1.2.0" becomes "^1.4.0" and an exact pin stays exact.
export function rangeFor(spec: string, latest: string): string {
  const prefix = /^(\^|~)/.exec(spec.trim())?.[1] ?? ''
  return `${prefix}${latest}`
}

// The install commands for a set of upgrades: one for dependencies and one
// for devDependencies, so each package stays in its own section.
export function installArgv(manager: Manager, upgrades: Upgrade[]): string[][] {
  const add = manager === 'npm' ? ['install'] : ['add']
  const dev = manager === 'npm' ? '--save-dev' : '-D'
  const argv: string[][] = []
  for (const isDev of [false, true]) {
    const names = upgrades.filter(u => u.isDev === isDev).map(u => `${u.name}@${rangeFor(u.spec, u.latest)}`)
    if (names.length > 0) argv.push([manager, ...add, ...(isDev ? [dev] : []), ...names])
  }
  return argv
}

// The installed version: the lock's, else the version the range is written
// from (a project not installed yet).
export function installedOf(declared: Declared, lock: unknown, fromModules?: string): Version | undefined {
  const text = fromModules ?? lockedVersion(lock, declared.name)
  return (text ? parseVersion(text) : undefined) ?? baseOf(declared.spec)
}

// pnpm's minimumReleaseAge: how many minutes a version must have been
// published before pnpm installs it. pnpm 11 and later wait one day unless
// pnpm-workspace.yaml or .npmrc says otherwise; pnpm 10 waited for nothing.
// minimumReleaseAgeExclude is not read: the wait has no exceptions here.
export const WORKSPACE = 'pnpm-workspace.yaml'
export const NPMRC = '.npmrc'
const PNPM_DEFAULT_AGE = 1440

export type ReleaseAge = { minutes: number }

export function releaseAgeOf(files: { workspace?: string; npmrc?: string; manifest?: unknown }): ReleaseAge {
  const own = /^minimumReleaseAge:\s*(\d+)/m.exec(files.workspace ?? '')
  let minutes = own ? Number(own[1]) : undefined
  if (minutes === undefined) {
    const rc = /^\s*minimum-?release-?age\s*=\s*(\d+)/im.exec(files.npmrc ?? '')
    if (rc) minutes = Number(rc[1])
  }
  if (minutes === undefined) {
    const pinned = (files.manifest as { packageManager?: unknown } | undefined)?.packageManager
    const major = typeof pinned === 'string' ? /^pnpm@(\d+)\./.exec(pinned)?.[1] : undefined
    minutes = major !== undefined && Number(major) < 11 ? 0 : PNPM_DEFAULT_AGE
  }
  return { minutes }
}

// The full record of a package, where the registry keeps each version's
// publication time.
export function packumentUrl(name: string): string {
  return `https://registry.npmjs.org/${name.replace('/', '%2F')}`
}

export function publishedAt(text: string, version: string): string | undefined {
  const time = (JSON.parse(text) as { time?: Record<string, unknown> }).time?.[version]
  return typeof time === 'string' ? time : undefined
}

// A wait in minutes, as the pane says it.
const span = (m: number) => (m >= 120 && m % 60 === 0 ? `${m / 60} h` : m >= 120 ? `${Math.floor(m / 60)} h` : `${m} min`)

// Why pnpm would refuse a version published at `published`, or undefined
// when it is old enough. A date that cannot be read blocks too: nothing goes
// up without proof that it waited.
export function ageConflict(published: string | undefined, now: number, minutes: number): string | undefined {
  if (minutes <= 0) return undefined
  const at = published ? Date.parse(published) : NaN
  if (Number.isNaN(at)) return `No pude leer cuándo se publicó: pnpm espera ${span(minutes)} para instalarla (minimumReleaseAge)`
  const age = Math.max(0, Math.floor((now - at) / 60_000))
  if (age >= minutes) return undefined
  const ago = age >= 60 ? `${Math.floor(age / 60)} h` : `${age} min`
  return `Publicada hace ${ago}: pnpm espera ${span(minutes)} para instalarla (minimumReleaseAge)`
}

// The environment pnpm installs under: the policy, strict and with no
// exclusions, so pnpm refuses a young version anywhere in the tree instead
// of writing an exception to pnpm-workspace.yaml.
export function releaseAgeEnv(minutes: number): Record<string, string> | undefined {
  if (minutes <= 0) return undefined
  return {
    PNPM_CONFIG_MINIMUM_RELEASE_AGE: String(minutes),
    PNPM_CONFIG_MINIMUM_RELEASE_AGE_STRICT: 'true',
    PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE: '[]',
  }
}

// What the pane says when pnpm refused an install for minimumReleaseAge, with
// pnpm's own list of the versions; undefined for any other failure.
export function ageRefusal(output: string, minutes: number): string | undefined {
  if (!/ERR_PNPM_NO_MATURE_MATCHING_VERSION|does not meet the minimumReleaseAge/.test(output)) return undefined
  const lines = output.split(/\r?\n/)
  const from = lines.findIndex(line => /minimumReleaseAge constraint/.test(line))
  const help = lines.findIndex((line, i) => i > from && /^\s*help:/.test(line))
  const detail = from === -1 ? [] : lines.slice(from, help === -1 ? from + 9 : Math.min(help, from + 9)).filter(line => line.trim())
  return [`Bloqueada por minimumReleaseAge: pnpm no instala dependencias publicadas hace menos de ${span(minutes)} y no se actualizó nada.`, ...detail].join('\n')
}

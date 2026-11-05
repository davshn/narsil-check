// The adapters, one per ecosystem the pane reads, and npm's own.

import type { Ecosystem } from '../types'
import { escapeRegex } from './adapter'
import type { Adapter } from './adapter'
import { CARGO } from './cargo'
import { GO } from './golang'
import { MAVEN } from './maven'
import { NUGET } from './nuget'
import { PUB } from './pub'
import { RUBYGEMS } from './rubygems'
import { SWIFTPM } from './swiftpm'
import { PYPI } from './pypi'
import { LOCKFILES, MANIFEST, installArgv, latestOf, latestUrl, managerOf, parseManifest, lockedVersion } from './npm'

export const NPM: Adapter = {
  id: 'npm',
  label: 'npm',
  manifests: [MANIFEST],
  lockfiles: LOCKFILES.map(([file]) => file),
  parse: files => {
    const text = files[MANIFEST]
    if (text === undefined) return []
    let lock: unknown
    try {
      lock = files['package-lock.json'] ? JSON.parse(files['package-lock.json']) : undefined
    } catch {
      lock = undefined
    }
    return parseManifest(text).map(d => ({ ...d, installed: lockedVersion(lock, d.name) }))
  },
  latestUrl,
  headers: { accept: 'application/json' },
  latestOf,
  installArgv: (present, upgrades) => installArgv(managerOf(present), upgrades),
  managerOf,
  importPattern: name => `(from[[:space:]]+|require\\(|import\\()['"]${escapeRegex(name)}(/[^'"]*)?['"]`,
  // package-lock.json (v2 and v3) lists every installed package by path.
  treeOf: files => {
    let lock: { packages?: Record<string, { version?: unknown; name?: unknown; link?: unknown }> } | undefined
    try {
      lock = files['package-lock.json'] ? JSON.parse(files['package-lock.json']) : undefined
    } catch {
      lock = undefined
    }
    const tree: { name: string; version: string }[] = []
    for (const [path, entry] of Object.entries(lock?.packages ?? {})) {
      if (!path.includes('node_modules/') || entry.link === true || typeof entry.version !== 'string') continue
      const name = typeof entry.name === 'string' ? entry.name : path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
      if (!tree.some(p => p.name === name && p.version === entry.version)) tree.push({ name, version: entry.version })
    }
    return tree
  },
  repoUrlOf: text => {
    const field = (JSON.parse(text) as { repository?: unknown }).repository
    const url = typeof field === 'string' ? field : (field as { url?: unknown } | undefined)?.url
    return typeof url === 'string' ? url : undefined
  },
}

export const ADAPTERS: Adapter[] = [NPM, PYPI, GO, CARGO, PUB, MAVEN, NUGET, RUBYGEMS, SWIFTPM]

export function adapterOf(id: Ecosystem): Adapter {
  return ADAPTERS.find(a => a.id === id) ?? NPM
}

export { escapeRegex, globRegex, holdNote, manifestOf, manifestsOf, specChanges } from './adapter'
export type { Adapter, Dep, Files } from './adapter'

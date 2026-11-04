// The adapters, one per ecosystem the pane reads, and npm's own.

import type { Ecosystem } from '../types'
import { escapeRegex } from './adapter'
import type { Adapter } from './adapter'
import { CARGO } from './cargo'
import { GO } from './golang'
import { PUB } from './pub'
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
  repoUrlOf: text => {
    const field = (JSON.parse(text) as { repository?: unknown }).repository
    const url = typeof field === 'string' ? field : (field as { url?: unknown } | undefined)?.url
    return typeof url === 'string' ? url : undefined
  },
}

export const ADAPTERS: Adapter[] = [NPM, PYPI, GO, CARGO, PUB]

export function adapterOf(id: Ecosystem): Adapter {
  return ADAPTERS.find(a => a.id === id) ?? NPM
}

export { escapeRegex, manifestOf, specChanges } from './adapter'
export type { Adapter, Dep, Files } from './adapter'

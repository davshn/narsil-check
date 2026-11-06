// Go modules: what go.mod requires, the Go proxy's latest release, the next
// major's module path (Go names a major past v1 as a new path, /v2), and
// how the bump group goes up.

import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex } from './adapter'

const MANIFEST = 'go.mod'
const SUM = 'go.sum'

// The direct requirements of go.mod: `require x v1.2.3` and `require ( ... )`
// blocks, leaving out what is only `// indirect` and what a `replace`
// directive points elsewhere.
export function parseGoMod(files: Files, withIndirect = false): Dep[] {
  const text = files[MANIFEST]
  if (text === undefined) return []
  const replaced = new Set<string>()
  const required: Dep[] = []
  let block: 'require' | 'replace' | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (block && line === ')') {
      block = undefined
      continue
    }
    const opened = /^(require|replace)\s*\($/.exec(line)
    if (opened) {
      block = opened[1] as 'require' | 'replace'
      continue
    }
    const single = /^(require|replace)\s+(.+)$/.exec(line)
    const kind = single ? (single[1] as 'require' | 'replace') : block
    const body = single ? (single[2] as string) : block ? line : ''
    if (!kind || !body || body.startsWith('//')) continue
    if (kind === 'replace') {
      replaced.add(body.split(/\s+/)[0] as string)
      continue
    }
    if (!withIndirect && /\/\/\s*indirect\b/.test(body)) continue
    const [path, version] = body.replace(/\s*\/\/.*$/, '').split(/\s+/)
    if (path && version) required.push({ name: path, spec: version, isDev: false, installed: version.replace(/^v/, '') })
  }
  return required.filter(d => !replaced.has(d.name))
}

// A module path as the proxy spells it: each capital letter as "!" and its
// lower case, so github.com/BurntSushi/toml is github.com/!burnt!sushi/toml.
export function proxyPath(path: string): string {
  return path.replace(/[A-Z]/g, c => `!${c.toLowerCase()}`)
}

// The module path of the next major: example.com/m -> example.com/m/v2,
// example.com/m/v2 -> example.com/m/v3, and gopkg.in's .v2 -> .v3.
export function nextMajorPath(path: string, current: string): string {
  const gopkg = /^(gopkg\.in\/.+\.v)(\d+)$/.exec(path)
  if (gopkg) return `${gopkg[1]}${Number(gopkg[2]) + 1}`
  const suffixed = /^(.+)\/v(\d+)$/.exec(path)
  if (suffixed) return `${suffixed[1]}/v${Number(suffixed[2]) + 1}`
  const major = Number(/^v?(\d+)/.exec(current)?.[1] ?? 0)
  return `${path}/v${Math.max(major, 1) + 1}`
}

// The module path a version lives at: from v2 on, the major is part of the
// path (example.com/m/v5, gopkg.in/yaml.v3), whatever path declared it.
export function majorPath(path: string, version: string): string {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0)
  const gopkg = /^(gopkg\.in\/.+\.v)\d+$/.exec(path)
  if (gopkg) return `${gopkg[1]}${major}`
  const base = path.replace(/\/v\d+$/, '')
  return major >= 2 ? `${base}/v${major}` : base
}

export const GO: Adapter = {
  id: 'go',
  label: 'Go',
  manifests: [MANIFEST],
  lockfiles: [SUM],
  parse: parseGoMod,
  latestUrl: name => `https://proxy.golang.org/${proxyPath(name)}/@latest`,
  releasedUrls: (name, version) => {
    const tag = version.startsWith('v') ? version : `v${version}`
    return [`https://proxy.golang.org/${proxyPath(majorPath(name, tag))}/@v/${proxyPath(tag)}.info`]
  },
  releasedOf: text => {
    const at = (JSON.parse(text) as { Time?: unknown }).Time
    return typeof at === 'string' ? at : undefined
  },
  latestOf: text => {
    const version = (JSON.parse(text) as { Version?: unknown }).Version
    // A pseudo-version (v0.0.0-20240101-abcdef) is a commit, not a release.
    return typeof version === 'string' && !/-\d{14}-[0-9a-f]{12}$/.test(version) ? version : undefined
  },
  nextMajor: nextMajorPath,
  installArgv: (_, upgrades) => [['go', 'get', ...upgrades.map(u => `${u.name}@${u.latest.startsWith('v') ? u.latest : `v${u.latest}`}`)], ['go', 'mod', 'tidy']],
  managerOf: () => 'go',
  // Every module go.mod requires, the indirect ones too: what the build uses.
  treeOf: files => parseGoMod(files, true).map(d => ({ name: d.name, version: d.spec.replace(/^v/, '') })),
  // An import of the module or any package in it: "github.com/x/y/sub".
  importPattern: name => `"${escapeRegex(name)}(/[^"]*)?"`,
  repoUrlOf: text => {
    const url = (JSON.parse(text) as { Origin?: { URL?: unknown } }).Origin?.URL
    return typeof url === 'string' ? url : undefined
  },
}

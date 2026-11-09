// GitHub Actions: each `uses:` of a workflow with a whole version, pinned to
// a tag (@v6.1.0) or to a commit with its version in a comment
// (@b843ebf... # v6.1.0). Like a Swift package, an action is a git repository
// and its releases are its tags. A moving tag (@v6) already follows its
// major, and a branch or a commit with no version says nothing to compare.

import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex } from './adapter'
import { SWIFTPM, latestTag } from './swiftpm'

const GLOBS = ['.github/workflows/*.yml', '.github/workflows/*.yaml', '.github/actions/*/action.yml', '.github/actions/*/action.yaml']

const COMMIT = /^[0-9a-f]{40}$/i

// One `uses:` line: its lead, owner/repo, a sub-action's path, the ref, a
// closing quote and a trailing comment.
const USES = /^([ \t]*(?:-[ \t]+)?uses:[ \t]*["']?)([\w.-]+\/[\w.-]+)(\/[^@\s"']*)?@([^\s"'#]+)(["']?)([ \t]*#[^\r\n]*)?/gm

const urlOf = (name: string) => `https://github.com/${name}`

function versionIn(ref: string, comment = ''): string | undefined {
  if (COMMIT.test(ref)) return /^[ \t]*#[ \t]*(?:tag[=:][ \t]*)?v?(\d+\.\d+(?:\.\d+)*)\b/.exec(comment)?.[1]
  return /^v?(\d+\.\d+\.\d+)$/.exec(ref)?.[1]
}

// One row per action: the first version found, the rest on a later scan.
export function parseWorkflows(files: Files): Dep[] {
  const deps: Dep[] = []
  for (const [path, text] of Object.entries(files)) {
    for (const m of text.matchAll(USES)) {
      const name = m[2] as string
      const version = versionIn(m[4] as string, m[6])
      if (version && !deps.some(d => d.name === name)) deps.push({ name, spec: version, isDev: false, installed: version, source: `file:${path}` })
    }
  }
  return deps
}

export const ACTIONS: Adapter = {
  id: 'actions',
  label: 'GitHub Actions',
  manifests: [],
  globs: GLOBS,
  lockfiles: [],
  parse: parseWorkflows,
  latestUrl: urlOf,
  latestCommand: name => ['git', 'ls-remote', '--tags', '--refs', urlOf(name)],
  // Only whole versions: v8 and v8.4 are moving tags over the latest v8.4.x.
  latestOf: stdout =>
    latestTag(
      stdout
        .split(/\r?\n/)
        .filter(line => /refs\/tags\/v?\d+\.\d+\.\d+/.test(line))
        .join('\n'),
    ),
  // The tag, bare or with a v, and what an annotated tag points at (^{}).
  pinCommand: u => ['git', 'ls-remote', '--tags', urlOf(u.name), ...[`v${u.latest}`, u.latest].flatMap(tag => [`refs/tags/${tag}`, `refs/tags/${tag}^{}`])],
  pinOf: stdout => {
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    const line = lines.find(l => l.endsWith('^{}')) ?? lines[0]
    const commit = line?.split(/\s/)[0]
    return commit && COMMIT.test(commit) ? commit : undefined
  },
  rewrite: (files, upgrades, pins) => {
    const out: Files = {}
    for (const [path, text] of Object.entries(files)) {
      const raised = text.replace(USES, (line: string, lead: string, name: string, sub: string | undefined, ref: string, quote: string, comment: string | undefined) => {
        const u = upgrades.find(x => x.name === name && x.spec === versionIn(ref, comment))
        if (!u) return line
        const at = `${lead}${name}${sub ?? ''}@`
        if (!COMMIT.test(ref)) return `${at}${ref.replace(u.spec, u.latest)}${quote}${comment ?? ''}`
        const pin = pins[name]
        return pin ? `${at}${pin}${quote}${(comment ?? '').replace(u.spec, u.latest)}` : line
      })
      if (raised !== text) out[path] = raised
    }
    return out
  },
  // A workflow runs what its file names: nothing to install.
  installArgv: () => [],
  managerOf: () => 'github actions',
  importPattern: name => `uses:[[:space:]]*["']?${escapeRegex(name)}`,
  repoUrlFor: urlOf,
  repoUrlOf: () => undefined,
  // Each release's date, from GitHub, the way a Swift package's is read.
  releasedUrls: (name, version) => SWIFTPM.releasedUrls?.(urlOf(name), version) ?? [],
  releasedOf: (text, headers) => SWIFTPM.releasedOf?.(text, headers),
}

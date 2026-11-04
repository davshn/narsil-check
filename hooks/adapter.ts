// The contract every ecosystem's adapter keeps. An adapter is pure: the
// hooks module reads the files it names, fetches the addresses it gives and
// runs the commands it builds.

import type { Ecosystem, Upgrade } from '../types'

// One declared dependency: its name, the range or version the manifest
// writes, whether it is a development one, and the version installed when
// a lockfile records it.
export type Dep = { name: string; spec: string; isDev: boolean; installed?: string }

// The files an adapter read, by path: whichever of its manifests and
// lockfiles exist.
export type Files = Record<string, string>

export type Adapter = {
  id: Ecosystem
  // How the pane names it: "npm", "PyPI", "Go", "Cargo", "Pub".
  label: string
  // The files whose presence says the project uses it; the first found is read.
  manifests: string[]
  // The lockfiles it reads for installed versions, and a commit carries.
  lockfiles: string[]
  parse: (files: Files) => Dep[]
  // Where its registry answers the latest release of `name`, and how.
  latestUrl: (name: string) => string
  headers?: Record<string, string>
  latestOf: (text: string) => string | undefined
  // Where a registry's latest stays within one major because each major is
  // its own name (Go's /v2 module paths): the name of the next major.
  nextMajor?: (name: string, current: string) => string
  // The install commands that take the bump group up, given which of its
  // files exist; with `rewrite` instead, the files the hooks write.
  installArgv: (present: string[], upgrades: Upgrade[], files: Files) => string[][]
  rewrite?: (files: Files, upgrades: Upgrade[]) => Files
  // What the button's note names as the tool: "npm", "uv", "cargo"...
  managerOf: (present: string[]) => string
  // An extended regex (git grep -E) for the project's imports of `name`.
  importPattern: (name: string) => string
  // The GitHub repository the registry's answer records, for release notes.
  repoUrlOf: (latestText: string) => string | undefined
}

// The manifest an adapter reads: the first of its manifests the project has.
export function manifestOf(adapter: Adapter, present: string[]): string | undefined {
  return adapter.manifests.find(m => present.includes(m))
}

// Each dependency's range at two points of the manifest (what HEAD holds and
// what the worktree holds): the ones whose range changed are pending.
export function specChanges(before: Dep[], after: Dep[]): { name: string; from: string; to: string }[] {
  const old = new Map(before.map(d => [d.name, d.spec]))
  return after
    .filter(d => old.has(d.name) && old.get(d.name) !== d.spec)
    .map(d => ({ name: d.name, from: old.get(d.name) as string, to: d.spec }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The contract every ecosystem's adapter keeps. An adapter is pure: the
// hooks module reads the files it names, fetches the addresses it gives and
// runs the commands it builds.

import type { Ecosystem, Upgrade } from '../types'

// One declared dependency: its name, the range or version the manifest
// writes, whether it is a development one, and the version installed when
// a lockfile records it. `display` is how the pane names it when that is not
// the name (a version catalog's shared "ktor" for eight libraries), and
// `source` where its version is written, for an adapter that rewrites it.
export type Dep = { name: string; spec: string; isDev: boolean; installed?: string; display?: string; source?: string }

// The files an adapter read, by path: whichever of its manifests and
// lockfiles exist.
export type Files = Record<string, string>

export type Adapter = {
  id: Ecosystem
  // How the pane names it: "npm", "PyPI", "Go", "Cargo", "Pub".
  label: string
  // The files whose presence says the project uses it, at the root.
  manifests: string[]
  // Manifests that may be anywhere in the tree ("**/build.gradle.kts",
  // "**/*.csproj"), found with git ls-files.
  globs?: string[]
  // The lockfiles it reads for installed versions, and a commit carries.
  lockfiles: string[]
  parse: (files: Files) => Dep[]
  // Where its registry answers the latest release of `name`, and how.
  latestUrl: (name: string) => string
  // A second registry asked when the first does not have it (a Gradle
  // plugin published as a library is on the Plugin Portal, not Central).
  alternateUrl?: (name: string) => string | undefined
  headers?: Record<string, string>
  latestOf: (text: string) => string | undefined
  // A command whose output `latestOf` reads, in place of `latestUrl`, for an
  // ecosystem with no registry (SwiftPM: git ls-remote --tags on the
  // package's own repository, which no API limit holds back).
  latestCommand?: (name: string) => string[]
  // The repository a name stands for, when the name is one (a SwiftPM
  // package is its git URL): release notes need no registry answer.
  repoUrlFor?: (name: string) => string | undefined
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
  // The GitHub repository the registry's answer records, for release notes;
  // read from `infoUrl`'s answer instead when the latest answer names none
  // (a version's POM, nuspec or gem record).
  repoUrlOf: (latestText: string) => string | undefined
  infoUrl?: (name: string, latest: string) => string
  // What else in the project an upgrade breaks, in words, when the
  // ecosystem knows (Kotlin and the compiler plugins built for one Kotlin).
  conflictsOf?: (upgrade: Upgrade, deps: Dep[], files: Files) => string[]
}

// Words that say a version is kept on purpose: "pin", "hold", "keep",
// "freeze", "do not upgrade", and in Spanish "fijar", "fijado",
// "congelado", "no actualizar".
const HOLD = /\b(pin(ned)?|hold|keep|freeze|frozen|do ?n[o']t (upgrade|update|bump)|fij(ar|ad[oa]|o)|congelad[oa]|no (actualizar|subir))\b/i

// The comment a line carries: after #, // or <!--, or the line itself
// when it is only a comment.
function commentOf(line: string): string | undefined {
  const m = /(?:^|\s)(?:#|\/\/|<!--)\s*(.*?)\s*(?:-->)?\s*$/.exec(line)
  return m ? (m[1] as string) : undefined
}

function mentions(line: string, key: string): boolean {
  return new RegExp(`(^|[^\\w.-])${escapeRegex(key)}([^\\w.-]|$)`).test(line)
}

// Why a dependency is kept where it is, when its manifest says so: a
// comment with a hold word on the line that writes its version, or on the
// line just above it. `keys` are the names the line may use for it (its
// name, a catalog's version key).
export function holdNote(files: Files, keys: string[], spec: string): string | undefined {
  for (const text of Object.values(files)) {
    const lines = text.split(/\r?\n/)
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n] as string
      if (!line.includes(spec) || !keys.some(k => k && mentions(line, k))) continue
      // The line above counts only when it is a comment alone: a trailing
      // comment there is another declaration's.
      const above = lines[n - 1] ?? ''
      for (const candidate of [line, /^\s*(#|\/\/|<!--)/.test(above) ? above : '']) {
        const comment = commentOf(candidate)
        if (comment && HOLD.test(comment)) return comment
      }
    }
  }
  return undefined
}

// A glob as a regex: "**/" any directories (none included), "*" within one.
export function globRegex(glob: string): RegExp {
  const body = glob
    .split('**/')
    .map(part => part.split('*').map(escapeRegex).join('[^/]*'))
    .join('(?:.*/)?')
  return new RegExp(`^${body}$`)
}

// The manifests among the files present: the root ones and the globbed ones.
export function manifestsOf(adapter: Adapter, present: string[]): string[] {
  const globs = (adapter.globs ?? []).map(globRegex)
  return present.filter(p => adapter.manifests.includes(p) || globs.some(g => g.test(p)))
}

// The first manifest the project has: whether it uses the ecosystem at all.
export function manifestOf(adapter: Adapter, present: string[]): string | undefined {
  return manifestsOf(adapter, present)[0]
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

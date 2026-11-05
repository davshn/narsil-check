// What the hooks module keeps in $.state and $.store: the type contract
// `claude plugin validate` holds every key to.

// `bump`: a patch or minor jump, usually a version change and nothing more.
// `review`: a major jump, whose breaking changes need reading.
// `expo`: outside the range the project's Expo SDK supports.
// `blocked`: the new version and the installed packages disagree on a peer
// dependency, so it cannot go up alone.
export type Group = 'bump' | 'review' | 'expo' | 'blocked'

export type Ecosystem = 'npm' | 'pypi' | 'go' | 'cargo' | 'pub' | 'maven' | 'nuget' | 'rubygems' | 'swiftpm'

export type Upgrade = {
  name: string
  ecosystem: Ecosystem
  // The range package.json declares, whose prefix (^, ~) an upgrade keeps.
  spec: string
  current: string
  latest: string
  bump: 'patch' | 'minor' | 'major'
  isDev: boolean
  group: Group
  // Each peer dependency the upgrade breaks, in words: what blocks it.
  conflicts: string[]
  // How the pane names it when that is not `name` ("ktor (8)" for a
  // version catalog's shared version), and where its version is written.
  display?: string
  source?: string
}

export type Scan =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'none' }
  | { status: 'error'; message: string }
  | { status: 'done'; upgrades: Upgrade[]; held: number; checked: number; failed: number; at: number; ecosystems: Ecosystem[] }

// An upgrade the pane runs: the package manager's install of the bump group.
export type Job =
  | { status: 'idle' }
  | { status: 'running'; manager: string; count: number }
  | { status: 'failed'; message: string }
  | { status: 'upgraded'; count: number; at: number }

// Upgraded ranges git shows uncommitted in package.json, and the files that
// hold them (package.json and its lockfile).
// `branch` is the one checked out; `isMain` whether it is the default branch,
// where the changes go to a new branch and a PR instead of a plain push.
export type Pending = {
  changes: { name: string; from: string; to: string }[]
  files: string[]
  manager: string
  branch: string
  isMain: boolean
}

// Turning the pending changes into a commit and a push, and from the default
// branch also a new branch and a PR (`url`).
export type Pr =
  | { status: 'idle' }
  | { status: 'running'; step: string }
  | { status: 'failed'; message: string }
  | { status: 'done'; branch: string; url?: string }

// Haiku's reading of why a major upgrade is not a plain bump, per jump
// ("name@from->to"): asked once and kept.
export type Difficulty = 'baja' | 'media' | 'alta'
export type Explained =
  | { status: 'loading' }
  | { status: 'done'; difficulty: Difficulty; text: string }
  | { status: 'failed'; text: string }

// A known vulnerability, as OSV.dev records it: its id and the ids it also
// goes by (CVE, GHSA, PYSEC), what it is, how bad, and the first version
// past the installed one that fixes it, when there is one.
export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'unknown'
export type Vuln = { id: string; aliases: string[]; summary: string; severity: Severity; fixed?: string }

// A package of the project with vulnerabilities: direct when the manifest
// declares it, else one of its dependencies' (read from the lockfile).
export type Finding = { name: string; display?: string; ecosystem: Ecosystem; version: string; isDirect: boolean; vulns: Vuln[] }

export type Audit =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'error'; message: string }
  | { status: 'done'; findings: Finding[]; checked: number; at: number }

// What the desktop app's session bar shows, read from its own MCP servers:
// where the session runs, its folder and branch, its connectors and whether
// Remote Control is on. `connectorsError` and `remoteError` say why a read
// or a switch failed.
export type Connector = { name: string; status: string; tools?: number }
export type Remote = 'on' | 'off' | 'connecting' | 'unavailable' | 'unknown'
export type SessionView = {
  isLoaded: boolean
  environment: string
  cwd: string
  branch: string
  worktree?: string
  connectors: Connector[]
  connectorsError?: string
  remote: Remote
  remoteError?: string
  isSwitching: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'narsil-check': {
      scan: Shaped<Scan>
      job: Shaped<Job>
      pending: Shaped<Pending>
      pr: Shaped<Pr>
      reasons: Shaped<Record<string, Explained>>
      isUpgradeOpen: Shaped<boolean>
      audit: Shaped<Audit>
      isVulnsOpen: Shaped<boolean>
      session: Shaped<SessionView>
      isEnvOpen: Shaped<boolean>
      isConnectorsOpen: Shaped<boolean>
    }
  }
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Audit, Explained, Finding, Group, Job, Pending, Pr, Pull, Scan, Severity, Upgrade } from '../types'
import { BATCH_SIZE, OSV_BATCH, OSV_VULN, SEVERITIES, SEVERITY_TITLE, batchBody, batchIds, bySeverity, fixedBy, mergeVulns, vulnCopyText, vulnOf, worstOf } from './osv'
import type { Package } from './osv'
import {
  NOTES_PER_RELEASE,
  NOTES_TOTAL,
  SYSTEM,
  breakingVersions,
  changelogSince,
  changelogUrl,
  clip,
  parseReason,
  prompt,
  reasonKey,
  releaseTags,
  releaseUrl,
  repoOf,
  upgradeCopyText,
} from './explain'
import type { Reason } from './explain'
import { ADAPTERS, NPM, adapterOf, holdNote, manifestOf, manifestsOf, specChanges } from './ecosystems'
import type { Adapter, Dep, Files } from './ecosystems'
import { branchName, commitBody, commitTitle, isMainBranch, prBody, prUrlOf } from './git'
import { EXPO_TABLE, LOCK, MANIFEST, NPMRC, WORKSPACE, ageConflict, ageRefusal, expoTableUrl, installedFromManifest, installedOf, latestUrl, packumentUrl, parseManifest, peerConflicts, pinConflicts, publishedAt, releaseAgeEnv, releaseAgeOf, upgradeOf, versionUrl } from './npm'
import type { Declared, Found, Installed } from './npm'
import { baseOf, bumpOf, parseVersion, show } from './semver'
import {
  CONNECTORS_SERVER,
  CONNECTORS_TOOL,
  DIRECTORY_SERVER,
  MOVE_TOOL,
  NO_SESSION,
  PICK_TOOL,
  TERMINAL_SERVER,
  TERMINAL_TOOL,
  pathOf,
  repositoryLabel,
  switchGlyph,
  webUrlOf,
  REMOTE_TOOL,
  SESSIONS_SERVER,
  SESSION_TOOL,
  connected,
  connectorLine,
  connectorsColor,
  connectorsLabel,
  envLabel,
  jsonOf,
  parseConnectors,
  parseRemote,
  parseSession,
  textOf,
} from './session'
import type { Remote, SessionView, Task, Todos } from '../types'
import { TODO_FILE, TOOL_ADD, TOOL_DONE, TOOL_LIST, TOOL_TEMPLATE, damagedPath, findTask, newTask, parseEntry, parseTodoFile, serializeTodos, templateArg, templateMatches, templatePrompt, todosColor, todosLabel, todosText, withExclude } from './todos'
import { COMMAND, COMMAND_HELP, GROUPS, NARSIL_SIZE, PALETTE, PANE, TITLE, agoLabel, auditSummary, commandHelp, groupLabel, narsilSvg, upgradeLine, sectionColor, sectionLabel, SEVERITY_COLOR, vulnsColor, vulnsLabel, failedNote, heldNote, jobNote, pendingLabel, pool, prNote, publishLabel, pullSummary, reasonLine, sortUpgrades, summaryOf, tail } from './words'
import { PARADA_CLARO, PARADA_OSCURO } from './narsil-art'

// Change a tag when its type's fields change: it declines what an earlier
// version stored, which outlives a reload.
const scan = atom({ plugin: 'narsil-check', key: 'scan' } as const, { status: 'idle' } as Scan, { shape: 'scan-4' })
const job = atom({ plugin: 'narsil-check', key: 'job' } as const, { status: 'idle' } as Job, { shape: 'job-1' })
const NO_PENDING: Pending = { changes: [], files: [], manager: 'npm', branch: '', isMain: false }
const pending = atom({ plugin: 'narsil-check', key: 'pending' } as const, NO_PENDING, { shape: 'pending-2' })
const pr = atom({ plugin: 'narsil-check', key: 'pr' } as const, { status: 'idle' } as Pr, { shape: 'pr-2' })
const reasons = atom({ plugin: 'narsil-check', key: 'reasons' } as const, {} as Record<string, Explained>, { shape: 'reasons-1' })
const audit = atom({ plugin: 'narsil-check', key: 'audit' } as const, { status: 'idle' } as Audit, { shape: 'audit-1' })
// Whether the vulnerabilities section is open; kept in the store too.
// The groups folded shut, and the last pull of the branch.
const closedGroups = atom({ plugin: 'narsil-check', key: 'closedGroups' } as const, [] as string[], { shape: 'closed-1' })
const pull = atom({ plugin: 'narsil-check', key: 'pull' } as const, { status: 'idle' } as Pull, { shape: 'pull-1' })
const isVulnsOpen = atom({ plugin: 'narsil-check', key: 'isVulnsOpen' } as const, false, { shape: 'open-1' })
const OSV_CONCURRENCY = 8
const OSV_MS = 30_000
// Whether the upgrade section is open; kept in the store across sessions.
const isUpgradeOpen = atom({ plugin: 'narsil-check', key: 'isUpgradeOpen' } as const, false, { shape: 'open-1' })
// The session section: what the app's session bar shows, and its two folds.
const session = atom({ plugin: 'narsil-check', key: 'session' } as const, NO_SESSION, { shape: 'session-2' })
const isEnvOpen = atom({ plugin: 'narsil-check', key: 'isEnvOpen' } as const, true, { shape: 'open-1' })
const isConnectorsOpen = atom({ plugin: 'narsil-check', key: 'isConnectorsOpen' } as const, false, { shape: 'open-1' })
const SESSION_MS = 15_000
// Pendientes: the list, whether it is unfolded, and the tasks whose content shows.
const todos = atom({ plugin: 'narsil-check', key: 'todos' } as const, { isLoaded: false, tasks: [] } as Todos, { shape: 'todos-2' })
const isTodosOpen = atom({ plugin: 'narsil-check', key: 'isTodosOpen' } as const, false, { shape: 'open-1' })
const openTodos = atom({ plugin: 'narsil-check', key: 'openTodos' } as const, [] as string[], { shape: 'ids-1' })

// Haiku reads each major jump once: its reading is kept in the store for good.
const EXPLAIN_CONCURRENCY = 2
const EXPLAIN_MS = 60_000

// An install may download a lot: the most $.process.run allows is ten minutes.
const INSTALL_MS = 10 * 60 * 1000
const GIT_MS = 2 * 60 * 1000
const VIEW_MS = 30 * 1000

// A registry answer is reused for this long, across sessions and projects.
const CACHE_MS = 6 * 60 * 60 * 1000
const CONCURRENCY = 8
// How many majors past the latest one a scan looks for, at most.
const MAX_MAJOR_HOPS = 6

type Cached = { version: string; at: number }

// A JSON file, or undefined when it is missing, too large or not JSON.
async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    if (!(await $.fs.exists(path))) return undefined
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

// The latest release in an ecosystem's registry, from the store while it is
// fresh. Where the registry's latest stays within a major (Go), the next
// major's address is asked too.
async function latestIn($: EngineInterface, adapter: Adapter, name: string, current: string, isFresh: boolean): Promise<string | undefined> {
  const key = `${adapter.id}:${name}`
  const cached = (await $.store.get(key)) as Cached | undefined
  if (!isFresh && cached && Date.now() - cached.at < CACHE_MS) return cached.version
  if (adapter.latestCommand) {
    const ran = await $.process.run(adapter.latestCommand(name), { timeoutMs: GIT_MS })
    const found = ran.exitCode === 0 ? adapter.latestOf(ran.stdout) : undefined
    if (found) await $.store.set(key, { version: found, at: Date.now() } satisfies Cached)
    return found
  }
  let res = await $.http.fetch(adapter.latestUrl(name), { headers: adapter.headers ?? {} })
  const alternate = res.ok ? undefined : adapter.alternateUrl?.(name)
  if (alternate) res = await $.http.fetch(alternate, { headers: adapter.headers ?? {} })
  if (!res.ok) return undefined
  let version = adapter.latestOf(res.text)
  // Each next major is asked for until one is not there: chi went from v1
  // to v5, every major between published.
  if (adapter.nextMajor && version) {
    let path = name
    for (let hop = 0; hop < MAX_MAJOR_HOPS; hop++) {
      path = adapter.nextMajor(path, version)
      const major = await fetchText($, adapter.latestUrl(path), adapter.headers)
      const found = major ? adapter.latestOf(major) : undefined
      if (!found) break
      version = found
    }
  }
  if (version) await $.store.set(key, { version, at: Date.now() } satisfies Cached)
  return version
}

// Which of an adapter's manifests and lockfiles the project has.
async function presentOf($: EngineInterface, adapter: Adapter): Promise<string[]> {
  const present: string[] = []
  for (const file of [...adapter.manifests, ...adapter.lockfiles]) if (await $.fs.exists(file)) present.push(file)
  // Manifests anywhere in the tree: the files git tracks or would track
  // (untracked, not ignored), so build output is left out.
  if (adapter.globs) {
    try {
      const listed = await $.process.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', ...adapter.globs.map(g => `:(glob)${g}`)], { timeoutMs: GIT_MS })
      if (listed.exitCode === 0) {
        for (const path of listed.stdout.split(/\r?\n/).map(l => l.trim())) if (path && !present.includes(path)) present.push(path)
      }
    } catch {
      // Not a git repository: only the root manifests count.
    }
  }
  return present
}

async function readFiles($: EngineInterface, paths: string[]): Promise<Files> {
  const files: Files = {}
  for (const path of paths) {
    try {
      files[path] = await $.fs.read(path)
    } catch {
      // Too large or unreadable: the adapter does without it.
    }
  }
  return files
}

// The ecosystems the project uses: each adapter whose manifest is there.
async function detected($: EngineInterface): Promise<{ adapter: Adapter; present: string[] }[]> {
  const found: { adapter: Adapter; present: string[] }[] = []
  for (const adapter of ADAPTERS) {
    const present = await presentOf($, adapter)
    if (manifestOf(adapter, present)) found.push({ adapter, present })
  }
  return found
}

async function fetchText($: EngineInterface, url: string, headers: Record<string, string> = {}): Promise<string | undefined> {
  try {
    const res = await $.http.fetch(url, { headers })
    return res.ok ? res.text : undefined
  } catch {
    return undefined
  }
}

// The release notes of the versions that break between the two: each one's
// GitHub release, else the package's CHANGELOG since the installed version.
async function releaseNotes($: EngineInterface, u: Upgrade): Promise<string> {
  const adapter = adapterOf(u.ecosystem)
  let repo: { owner: string; repo: string } | undefined
  if (u.ecosystem === 'npm') {
    const installed = await readJson($, `node_modules/${u.name}/package.json`)
    repo = repoOf(installed) ?? repoOf(JSON.parse((await fetchText($, latestUrl(u.name))) ?? '{}'))
  } else if (adapter.repoUrlFor) {
    const url = adapter.repoUrlFor(u.name)
    repo = url ? repoOf({ repository: url }) : undefined
  } else {
    const text = await fetchText($, adapter.infoUrl?.(u.name, u.latest) ?? adapter.latestUrl(u.name), adapter.headers)
    const url = text ? adapter.repoUrlOf(text) : undefined
    repo = url ? repoOf({ repository: url }) : undefined
  }
  const parts: string[] = []
  if (repo) {
    for (const version of breakingVersions(u.current, u.latest)) {
      for (const tag of releaseTags(u.name, version)) {
        const text = await fetchText($, releaseUrl(repo.owner, repo.repo, tag), { accept: 'application/vnd.github+json' })
        const body = text ? (JSON.parse(text) as { body?: unknown }).body : undefined
        if (typeof body === 'string' && body.trim()) {
          parts.push(`## ${tag}\n${clip(body, NOTES_PER_RELEASE)}`)
          break
        }
      }
    }
  }
  // unpkg serves npm packages' files only.
  if (parts.length === 0 && u.ecosystem === 'npm') {
    const changelog = await fetchText($, changelogUrl(u.name, u.latest))
    if (changelog) parts.push(changelogSince(changelog, u.current))
  }
  return clip(parts.join('\n\n'), NOTES_TOTAL)
}

// Where the project imports the library: the files and their import lines.
async function usageOf($: EngineInterface, u: Upgrade): Promise<{ files: number; lines: string[] }> {
  try {
    const ran = await $.process.run(['git', '--no-pager', 'grep', '-n', '-I', '-E', adapterOf(u.ecosystem).importPattern(u.name), '--', '.', ':!node_modules'], { timeoutMs: GIT_MS })
    const lines = ran.stdout.split(/\r?\n/).filter(l => l.trim())
    const files = new Set(lines.map(l => l.split(':')[0]))
    return { files: files.size, lines: lines.slice(0, 40).map(l => l.slice(0, 200)) }
  } catch {
    return { files: 0, lines: [] }
  }
}

function setReason($: EngineInterface, key: string, value: Explained): Promise<Record<string, Explained>> {
  return update($, reasons, all => ({ ...all, [key]: value }))
}

// Haiku's reading of one major upgrade, from the store when it was read before.
async function explain($: EngineInterface, u: Upgrade): Promise<void> {
  const key = reasonKey(u)
  const stored = (await $.store.get(`why:${key}`)) as Reason | undefined
  if (stored) {
    await setReason($, key, { status: 'done', ...stored })
    return
  }
  await setReason($, key, { status: 'loading' })
  const [notes, usage] = await Promise.all([releaseNotes($, u), usageOf($, u)])
  const reply = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt: prompt(u, notes, usage), maxTokens: 400, timeoutMs: EXPLAIN_MS })
  const reason = reply.isAnswered ? parseReason(reply.text) : undefined
  if (!reason) {
    await setReason($, key, { status: 'failed', text: 'Haiku no dio una razón; revisa las notas de la versión.' })
    return
  }
  await $.store.set(`why:${key}`, reason)
  await setReason($, key, { status: 'done', ...reason })
}

// Every major upgrade not read yet, a couple at a time.
async function explainMajors($: EngineInterface, upgrades: Upgrade[]): Promise<void> {
  const known = await read($, reasons)
  const todo = upgrades.filter(u => u.group === 'review' && known[reasonKey(u)]?.status !== 'done' && known[reasonKey(u)]?.status !== 'loading')
  await pool(todo, EXPLAIN_CONCURRENCY, async u => {
    try {
      await explain($, u)
    } catch {
      await setReason($, reasonKey(u), { status: 'failed', text: 'No pude analizar esta actualización.' })
    }
  })
}

type Surface = Parameters<EngineInterface['ui']['copy']>[0]['surface']

// Puts one row of the pane on the clipboard of the surface the press came from.
async function copyRow($: EngineInterface, text: string, surface: Surface): Promise<void> {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? 'Copiado al portapapeles.' : `No pude copiar: ${copied.reason}`)
}

// Folds or unfolds one upgrade group or vulnerability severity.
function toggleGroup($: EngineInterface, key: string): Promise<string[]> {
  return update($, closedGroups, keys => (keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]))
}

// The peers a published version asks for. A version never changes once
// published, so its answer is kept for good.
async function targetPeers($: EngineInterface, name: string, version: string): Promise<Installed | undefined> {
  const parsed = parseVersion(version)
  if (!parsed) return undefined
  const key = `peers:${name}@${version}`
  const cached = (await $.store.get(key)) as { peers: Record<string, string>; optional: string[] } | undefined
  if (cached) return { version: parsed, ...cached }
  const text = await fetchText($, versionUrl(name, version), { accept: 'application/json' })
  if (!text) return undefined
  const target = installedFromManifest(JSON.parse(text), parsed)
  await $.store.set(key, { peers: target.peers, optional: target.optional })
  return target
}

// The minutes pnpm's minimumReleaseAge waits in a pnpm project, else 0. Read
// as HEAD holds it: CI installs from the commit, and the PR carries
// package.json and the lockfile alone. Outside git, the file as it is.
// minimumReleaseAgeExclude never counts, at HEAD or in the worktree.
async function releaseMinutes($: EngineInterface): Promise<number> {
  if (!(await $.fs.exists('pnpm-lock.yaml'))) return 0
  const text = async (path: string) => {
    const head = await $.process.run(['git', '--no-pager', 'show', `HEAD:${path}`], { timeoutMs: GIT_MS }).catch(() => undefined)
    if (head?.exitCode === 0) return head.stdout
    if (head && /does not exist in|exists on disk, but not in/.test(head.stderr)) return undefined
    return (await $.fs.exists(path)) ? await $.fs.read(path).catch(() => undefined) : undefined
  }
  return releaseAgeOf({ workspace: await text(WORKSPACE), npmrc: await text(NPMRC), manifest: await readJson($, MANIFEST) }).minutes
}

// A version's publication time as `pnpm view` reads it, or undefined when
// pnpm cannot say.
async function viewedAt($: EngineInterface, name: string, version: string): Promise<string | undefined> {
  try {
    const ran = await runCommand($, ['pnpm', 'view', name, 'time', '--json'], VIEW_MS)
    if (ran.exitCode !== 0 || ran.isStdoutTruncated) return undefined
    const time = (JSON.parse(ran.stdout) as Record<string, unknown>)[version]
    return typeof time === 'string' ? time : undefined
  } catch {
    return undefined
  }
}

// The upgrades pnpm would refuse for being younger than its
// minimumReleaseAge, each with why: one whose publication date cannot be read
// is refused too. Only in a pnpm project. A date never changes once
// published, so it is kept for good.
async function youngConflicts($: EngineInterface, upgrades: Upgrade[]): Promise<Map<Upgrade, string[]>> {
  const young = new Map<Upgrade, string[]>()
  const minutes = await releaseMinutes($)
  if (minutes <= 0) return young
  const now = Date.now()
  await pool(upgrades, CONCURRENCY, async u => {
    if (u.group === 'expo') return
    const key = `published:${u.name}@${u.latest}`
    let published = (await $.store.get(key)) as string | undefined
    if (published === undefined) {
      const page = await fetchText($, packumentUrl(u.name), { accept: 'application/json' }).catch(() => undefined)
      try {
        published = page ? publishedAt(page, u.latest) : undefined
      } catch {
        published = undefined
      }
      // The host does not hand back a large packument (astro's and
      // tailwindcss's run to ~10 MB), so pnpm reads the dates itself.
      if (!published) published = await viewedAt($, u.name, u.latest)
      if (published) await $.store.set(key, published)
    }
    const why = ageConflict(published, now, minutes)
    if (why) young.set(u, [why])
  })
  return young
}

// The SDK's table of native module ranges: the installed copy, else the one
// published with the installed Expo version.
async function expoTable($: EngineInterface, expo: string | undefined): Promise<Record<string, string> | undefined> {
  const local = await readJson($, EXPO_TABLE)
  if (local && typeof local === 'object') return local as Record<string, string>
  if (!expo) return undefined
  const res = await $.http.fetch(expoTableUrl(expo))
  return res.ok ? (JSON.parse(res.text) as Record<string, string>) : undefined
}

// A section opens by itself when a result first has something to show.
const hasUpgrades = (value: Scan) => value.status === 'done' && value.upgrades.length > 0
const hasFindings = (value: Audit) => value.status === 'done' && value.findings.length > 0

async function setScan($: EngineInterface, value: Scan): Promise<Scan> {
  const before = await read($, scan)
  const after = await update($, scan, () => value)
  if (hasUpgrades(after) && !hasUpgrades(before)) await update($, isUpgradeOpen, () => true)
  return after
}

let running: Promise<void> | undefined

// One scan at a time: a second request while one runs waits for it.
function runScan($: EngineInterface, isFresh = false): Promise<void> {
  running ??= scanProject($, isFresh).finally(() => {
    running = undefined
  })
  return running
}

async function setAudit($: EngineInterface, value: Audit): Promise<Audit> {
  const before = await read($, audit)
  const after = await update($, audit, () => value)
  if (hasFindings(after) && !hasFindings(before)) await update($, isVulnsOpen, () => true)
  return after
}

// What the vulnerabilities check asks about: every package each lockfile
// installs where the adapter reads one, the declared ones elsewhere.
async function auditedPackages($: EngineInterface): Promise<Package[]> {
  const packages: Package[] = []
  for (const { adapter, present } of await detected($)) {
    const files = await readFiles($, present)
    const declared = adapter.parse(files)
    const direct = new Map(declared.map(d => [d.name, d]))
    const tree = adapter.treeOf?.(files) ?? []
    const listed =
      tree.length > 0
        ? tree.map(p => ({ name: p.name, version: p.version, isDirect: direct.has(p.name) }))
        : declared.flatMap(d => {
            const base = baseOf(d.spec)
            const version = d.installed ?? (base ? show(base) : undefined)
            return version ? [{ name: d.name, version, isDirect: true }] : []
          })
    for (const p of listed) {
      const display = direct.get(p.name)?.display
      packages.push({ ...p, ecosystem: adapter.id, ...(display ? { display } : {}) })
    }
  }
  return packages
}

// One advisory's record, from the store while OSV says it has not changed.
async function advisoryOf($: EngineInterface, id: string, modified: string): Promise<unknown> {
  const key = `osv:${id}`
  const cached = (await $.store.get(key)) as { modified: string; advisory: unknown } | undefined
  if (cached && cached.modified === modified) return cached.advisory
  const text = await fetchText($, `${OSV_VULN}${encodeURIComponent(id)}`, { accept: 'application/json' })
  if (!text) return undefined
  const advisory = JSON.parse(text) as Record<string, unknown>
  // Only what the pane reads: the full record can hold pages of details.
  const kept = {
    id: advisory.id,
    aliases: advisory.aliases,
    summary: advisory.summary,
    details: typeof advisory.details === 'string' ? advisory.details.split('\n')[0] : undefined,
    database_specific: advisory.database_specific,
    severity: advisory.severity,
    affected: advisory.affected,
  }
  await $.store.set(key, { modified, advisory: kept })
  return kept
}

let auditing: Promise<void> | undefined

// One audit at a time, as one scan.
function runAudit($: EngineInterface): Promise<void> {
  auditing ??= auditProject($).finally(() => {
    auditing = undefined
  })
  return auditing
}

async function auditProject($: EngineInterface): Promise<void> {
  const packages = await auditedPackages($)
  if (packages.length === 0) {
    await setAudit($, { status: 'done', findings: [], checked: 0, at: Date.now() })
    return
  }
  await setAudit($, { status: 'scanning' })
  try {
    const ids: { id: string; modified: string }[][] = []
    for (let i = 0; i < packages.length; i += BATCH_SIZE) {
      const res = await $.http.fetch(OSV_BATCH, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: batchBody(packages.slice(i, i + BATCH_SIZE)) })
      if (!res.ok) throw new Error(`OSV respondió ${res.status}`)
      ids.push(...batchIds(res.text))
    }
    const findings: Finding[] = []
    await pool(
      packages.map((p, i) => ({ p, list: ids[i] ?? [] })).filter(x => x.list.length > 0),
      OSV_CONCURRENCY,
      async ({ p, list }) => {
        const vulns = []
        for (const { id, modified } of list) {
          const advisory = await advisoryOf($, id, modified)
          if (advisory) vulns.push(vulnOf(advisory as never, p))
        }
        const merged = mergeVulns(vulns)
        if (merged.length > 0) findings.push({ name: p.name, ecosystem: p.ecosystem, version: p.version, isDirect: p.isDirect, vulns: merged, ...(p.display ? { display: p.display } : {}) })
      },
    )
    findings.sort((a, b) => SEVERITIES.indexOf(worstOf(a.vulns)) - SEVERITIES.indexOf(worstOf(b.vulns)) || Number(b.isDirect) - Number(a.isDirect) || a.name.localeCompare(b.name))
    await setAudit($, { status: 'done', findings, checked: packages.length, at: Date.now() })
  } catch (err) {
    await setAudit($, { status: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

type Scanned = { upgrades: Upgrade[]; held: number; checked: number; failed: number }

// Any ecosystem but npm: what the manifest declares, what the lockfile says
// is installed, and how far the registry's latest is.
async function scanGeneric($: EngineInterface, adapter: Adapter, present: string[], isFresh: boolean): Promise<Scanned> {
  const files = await readFiles($, present)
  const deps = adapter.parse(files)
  let failed = 0
  const found = await pool(deps, CONCURRENCY, async (d: Dep): Promise<Upgrade | 'current' | undefined> => {
    const installed = parseVersion(d.installed ?? '') ?? baseOf(d.spec)
    if (!installed) return undefined
    try {
      const text = await latestIn($, adapter, d.name, show(installed), isFresh)
      const latest = text ? parseVersion(text) : undefined
      if (!latest) return 'current'
      const bump = bumpOf(installed, latest)
      if (bump === 'none') return 'current'
      const group = bump === 'major' ? 'review' : 'bump'
      const upgrade: Upgrade = { name: d.name, ecosystem: adapter.id, spec: d.spec, current: show(installed), latest: text as string, bump, isDev: d.isDev, group, conflicts: [] }
      if (d.display) upgrade.display = d.display
      if (d.source) upgrade.source = d.source
      return upgrade
    } catch {
      failed++
      return 'current'
    }
  })
  const upgrades = found.filter((f): f is Upgrade => typeof f === 'object')
  // An upgrade the project keeps on purpose, or one the ecosystem knows
  // breaks something else, cannot go up alone, whatever its jump.
  for (const u of upgrades) {
    const ref = u.source?.startsWith('catalog:versions.') ? u.source.slice('catalog:versions.'.length) : undefined
    const hold = holdNote(files, [u.name, u.display ?? '', ref ?? ''], u.spec)
    u.conflicts = [...(hold ? [`Fijada a propósito: «${hold}»`] : []), ...(adapter.conflictsOf?.(u, deps, files) ?? [])]
    if (u.conflicts.length > 0) u.group = 'blocked'
  }
  return { upgrades, held: 0, checked: found.filter(f => f !== undefined).length, failed }
}

async function scanProject($: EngineInterface, isFresh: boolean): Promise<void> {
  const ecosystems = await detected($)
  if (ecosystems.length === 0) {
    await setScan($, { status: 'none' })
    return
  }
  await setScan($, { status: 'scanning' })
  try {
    const all: Scanned = { upgrades: [], held: 0, checked: 0, failed: 0 }
    for (const { adapter, present } of ecosystems) {
      const part = adapter.id === 'npm' ? await scanNpm($, isFresh) : await scanGeneric($, adapter, present, isFresh)
      all.upgrades.push(...part.upgrades)
      all.held += part.held
      all.checked += part.checked
      all.failed += part.failed
    }
    const { upgrades, held, checked, failed } = all
    await setScan($, { status: 'done', upgrades: sortUpgrades(upgrades), held, checked, failed, at: Date.now(), ecosystems: ecosystems.map(e => e.adapter.id) })
    // Haiku reads the majors and OSV the vulnerabilities in the background:
    // the list shows at once.
    void explainMajors($, upgrades).catch(() => undefined)
    void runAudit($).catch(() => undefined)
    await checkPending($)
  } catch (err) {
    await setScan($, { status: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

// npm, with what only npm has: Expo's table, node_modules, peer
// dependencies and exact pins in the lockfile.
async function scanNpm($: EngineInterface, isFresh: boolean): Promise<Scanned> {
  {
    const declared = parseManifest(await $.fs.read(MANIFEST))
    const lock = await readJson($, LOCK)
    let failed = 0
    const installedMap = new Map<string, Installed>()
    const found = await pool(declared, CONCURRENCY, async (d: Declared): Promise<Found | undefined> => {
      const installedPkg = (await readJson($, `node_modules/${d.name}/package.json`)) as { version?: string } | undefined
      const installed = installedOf(d, lock, installedPkg?.version)
      if (!installed) return undefined
      installedMap.set(d.name, installedFromManifest(installedPkg, installed))
      try {
        const latest = await latestIn($, NPM, d.name, show(installed), isFresh)
        return { declared: d, installed, latest: latest ? parseVersion(latest) : undefined }
      } catch {
        failed++
        return { declared: d, installed }
      }
    })
    const checked = found.filter(f => f !== undefined)
    const expoFound = checked.find(f => f.declared.name === 'expo')
    const table = expoFound ? await expoTable($, show(expoFound.installed)) : undefined
    const upgrades: Upgrade[] = []
    let held = 0
    for (const f of checked) {
      const u = upgradeOf(f, table)
      if (u === 'held') held++
      else if (u) upgrades.push(u)
    }
    // An upgrade a peer dependency blocks, or one a package in the tree pins
    // to an exact version, cannot go up alone, whatever its jump.
    const peers = new Map<Upgrade, string[]>()
    await pool(upgrades, CONCURRENCY, async u => {
      if (u.group === 'expo') return
      const target = await targetPeers($, u.name, u.latest)
      peers.set(u, target ? peerConflicts(u.name, target, installedMap) : [])
    })
    // pnpm refuses a version younger than its minimumReleaseAge, and so does
    // CI's frozen install: such an upgrade waits, blocked, until it is old enough.
    const young = await youngConflicts($, upgrades)
    // The trivial upgrades the button installs together, until no pin
    // blocks one of them: a blocked one leaves the batch, which can block
    // a sibling it carried.
    for (let changed = true; changed; ) {
      changed = false
      const batch = new Map(upgrades.filter(u => u.group === 'bump').map(u => [u.name, u.latest] as const))
      for (const u of upgrades) {
        const own = peers.get(u)
        const version = parseVersion(u.latest)
        if (own === undefined || !version) continue
        u.conflicts = [...own, ...(young.get(u) ?? []), ...pinConflicts(u.name, version, lock, batch)]
        const group = u.conflicts.length > 0 ? 'blocked' : u.bump === 'major' ? 'review' : 'bump'
        if (group !== u.group) {
          u.group = group
          changed = true
        }
      }
    }
    return { upgrades, held, checked: checked.length, failed }
  }
}

function setJob($: EngineInterface, value: Job): Promise<Job> {
  return update($, job, () => value)
}

// Runs a command. With no shell, Windows starts npm only by its .cmd shim,
// so a command that cannot start is tried again as one.
async function runCommand($: EngineInterface, argv: string[], timeoutMs = INSTALL_MS, env?: Record<string, string>) {
  const [command, ...args] = argv
  const init = env ? { timeoutMs, env } : { timeoutMs }
  try {
    return await $.process.run(argv, init)
  } catch (err) {
    try {
      return await $.process.run([`${command}.cmd`, ...args], init)
    } catch {
      throw err
    }
  }
}

// The upgraded ranges uncommitted in each ecosystem's manifest: what a PR
// would hold. Each manifest as HEAD holds it is read with its adapter and
// compared with the worktree's, so it holds across sessions and for
// upgrades made by hand. Outside a git repository there is nothing pending.
async function checkPending($: EngineInterface): Promise<void> {
  let value = NO_PENDING
  try {
    const changes: Pending['changes'] = []
    const tracked: string[] = []
    const managers: string[] = []
    for (const { adapter, present } of await detected($)) {
      let changed = false
      // Each manifest on its own: a catalog and nine build files each.
      for (const manifest of manifestsOf(adapter, present)) {
        const head = await $.process.run(['git', '--no-pager', 'show', `HEAD:${manifest}`], { timeoutMs: GIT_MS })
        if (head.exitCode !== 0) continue
        const before = adapter.parse({ [manifest]: head.stdout })
        const after = adapter.parse(await readFiles($, [manifest]))
        const own = specChanges(before, after)
        if (own.length === 0) continue
        changes.push(...own)
        tracked.push(manifest)
        changed = true
      }
      if (!changed) continue
      // Its lockfiles, at the root and wherever the tree holds them (an
      // Xcode project keeps Package.resolved inside its workspace).
      tracked.push(...adapter.lockfiles, ...present.filter(p => adapter.lockfiles.some(l => p.endsWith(`/${l}`))))
      managers.push(adapter.managerOf(present))
    }
    if (changes.length > 0) {
      const status = await $.process.run(['git', 'status', '--porcelain', '--', ...tracked], { timeoutMs: GIT_MS })
      // " M path": a tracked file changed in the worktree.
      const files = status.stdout
        .split(/\r?\n/)
        .filter(l => /^.M /.test(l) || /^M. /.test(l))
        .map(l => l.slice(3).trim())
      const branch = (await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: GIT_MS })).stdout.trim()
      const originHead = await $.process.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { timeoutMs: GIT_MS })
      const isMain = isMainBranch(branch, originHead.exitCode === 0 ? originHead.stdout : '')
      value = { changes, files, manager: managers.join(', '), branch, isMain }
    }
  } catch {
    value = NO_PENDING
  }
  await update($, pending, () => value)
}

function setPr($: EngineInterface, value: Pr): Promise<Pr> {
  return update($, pr, () => value)
}

// One git or gh step: its output, or a failure naming the step.
async function step($: EngineInterface, label: string, argv: string[]): Promise<string> {
  await setPr($, { status: 'running', step: label })
  const ran = await runCommand($, argv, GIT_MS)
  if (ran.exitCode !== 0) throw new Error(`${label}: ${tail(ran.stderr || ran.stdout)}`)
  return ran.stdout
}

// A commit of package.json and its lockfile alone, then a push. On a work
// branch that is all: the person takes it from there. On the default branch
// the commit goes to a new branch first, with a PR back to it; that branch
// stays checked out, since going back would put the old versions in
// package.json while node_modules holds the new ones.
async function publish($: EngineInterface): Promise<void> {
  if ((await read($, pr)).status === 'running') return
  const { changes, files, manager } = await read($, pending)
  if (changes.length === 0) return
  try {
    const base = (await step($, 'Leyendo la rama actual', ['git', 'branch', '--show-current'])).trim()
    if (!base) throw new Error('No estás en una rama (HEAD separado): cambia a una rama antes de subir los cambios.')
    const originHead = await $.process.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { timeoutMs: GIT_MS })
    if (!isMainBranch(base, originHead.exitCode === 0 ? originHead.stdout : '')) {
      await step($, 'Preparando el commit', ['git', 'add', '--', ...files])
      await step($, 'Haciendo el commit', ['git', 'commit', '-m', commitTitle(changes), '-m', commitBody(changes), '--', ...files])
      await step($, 'Subiendo la rama', ['git', 'push', '-u', 'origin', base])
      await setPr($, { status: 'done', branch: base })
      $.ui.toast(`Commit subido a ${base}.`)
      await checkPending($)
      return
    }
    const now = Date.now()
    const taken = await $.process.run(['git', 'rev-parse', '--verify', '--quiet', `refs/heads/${branchName(now, false)}`], { timeoutMs: GIT_MS })
    const branch = branchName(now, taken.exitCode === 0)
    await step($, 'Creando la rama', ['git', 'switch', '-c', branch])
    await step($, 'Preparando el commit', ['git', 'add', '--', ...files])
    await step($, 'Haciendo el commit', ['git', 'commit', '-m', commitTitle(changes), '-m', commitBody(changes), '--', ...files])
    await step($, 'Subiendo la rama', ['git', 'push', '-u', 'origin', branch])
    const out = await step($, 'Creando el PR', ['gh', 'pr', 'create', '--base', base, '--head', branch, '--title', commitTitle(changes), '--body', prBody(changes, manager)])
    const url = prUrlOf(out) ?? out.trim()
    await setPr($, { status: 'done', url, branch })
    $.ui.toast(`PR creado: ${url}`)
  } catch (err) {
    await setPr($, { status: 'failed', message: err instanceof Error ? err.message : String(err) })
  }
  await checkPending($)
}

// Installs every upgrade of the bump group at once, then scans again.
async function upgradeBumps($: EngineInterface): Promise<void> {
  if ((await read($, job)).status === 'running') return
  const state = await read($, scan)
  if (state.status !== 'done') return
  const bumps = state.upgrades.filter(u => u.group === 'bump')
  if (bumps.length === 0) return
  // Each ecosystem installs its own, with its own tool.
  const plans: { adapter: Adapter; present: string[]; upgrades: Upgrade[] }[] = []
  for (const { adapter, present } of await detected($)) {
    const upgrades = bumps.filter(u => u.ecosystem === adapter.id)
    if (upgrades.length > 0) plans.push({ adapter, present, upgrades })
  }
  const manager = plans.map(p => p.adapter.managerOf(p.present)).join(', ')
  await setJob($, { status: 'running', manager, count: bumps.length })
  try {
    for (const { adapter, present, upgrades } of plans) {
      const files = await readFiles($, present)
      if (adapter.rewrite) for (const [path, text] of Object.entries(adapter.rewrite(files, upgrades))) await $.fs.write(path, text)
      // pnpm installs under minimumReleaseAge strictly and with no
      // exclusions: a young version anywhere in the tree fails the install
      // instead of landing in the lockfile with an exception.
      const minutes = adapter.id === 'npm' && adapter.managerOf(present) === 'pnpm' ? await releaseMinutes($) : 0
      for (const argv of adapter.installArgv(present, upgrades, files)) {
        const ran = await runCommand($, argv, INSTALL_MS, releaseAgeEnv(minutes))
        if (ran.exitCode !== 0) {
          const refused = minutes > 0 ? ageRefusal(`${ran.stderr}\n${ran.stdout}`, minutes) : undefined
          await setJob($, { status: 'failed', message: refused ?? `${argv.slice(0, 2).join(' ')} terminó con código ${ran.exitCode}: ${tail(ran.stderr || ran.stdout)}` })
          await runScan($, true)
          return
        }
      }
    }
    await setJob($, { status: 'upgraded', count: bumps.length, at: Date.now() })
    $.ui.toast(`Actualicé ${bumps.length} ${bumps.length === 1 ? 'librería' : 'librerías'} con ${manager}.`)
  } catch (err) {
    await setJob($, { status: 'failed', message: `No pude ejecutar ${manager}: ${err instanceof Error ? err.message : String(err)}` })
  }
  await runScan($, true)
}

function setSession($: EngineInterface, fn: (view: SessionView) => SessionView): Promise<SessionView> {
  return update($, session, fn)
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Reads what the session bar shows: the folder and branch from the engine and
// git, the rest from the desktop app's own servers. A part that cannot be read
// keeps its reason, so the section says why instead of staying empty.
// `isFinal: false` writes only a full read, so a failed one leaves the
// section reading instead of showing an error that a retry may clear.
// `withServers: false` reads only the folder and git, keeping what the app's
// servers last said: each call to them reaches every other mod as a tool call.
// Resolves whether the app's servers answered.
async function loadSession($: EngineInterface, isFinal = true, withServers = true): Promise<boolean> {
  const cwd = await $.session.cwd().catch(() => '')
  const branch = await $.process
    .run(['git', 'branch', '--show-current'], { timeoutMs: SESSION_MS })
    .then(r => (r.exitCode === 0 ? r.stdout.trim() : ''))
    .catch(() => '')
  const repository = await $.process
    .run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: SESSION_MS })
    .then(r => (r.exitCode === 0 ? (webUrlOf(r.stdout) ?? '') : ''))
    .catch(() => '')
  if (!withServers) {
    await setSession($, view => ({ ...view, isLoaded: true, repository, cwd, branch }))
    return true
  }

  let connectors: Pick<SessionView, 'connectors' | 'connectorsError'>
  try {
    const result = await $.mcp.call(CONNECTORS_SERVER, CONNECTORS_TOOL)
    const list = result.isError ? undefined : parseConnectors(result.structuredContent ?? jsonOf(result.content))
    connectors = list ? { connectors: list } : { connectors: [], connectorsError: textOf(result.content) || 'respuesta sin conectores' }
  } catch (err) {
    connectors = { connectors: [], connectorsError: errorText(err) }
  }

  let where: Pick<SessionView, 'remote' | 'worktree' | 'remoteError'>
  try {
    const result = await $.mcp.call(SESSIONS_SERVER, SESSION_TOOL, { session_id: 'self' })
    const read = result.isError ? undefined : parseSession(result.structuredContent ?? jsonOf(result.content))
    where = read ?? { remote: 'unknown', remoteError: textOf(result.content) || 'respuesta sin sesión' }
  } catch (err) {
    where = { remote: 'unknown', remoteError: errorText(err) }
  }

  const isRead = !connectors.connectorsError && !where.remoteError
  if (isRead || isFinal) await setSession($, view => ({ isLoaded: true, repository, cwd, branch, ...connectors, ...where, isSwitching: view.isSwitching }))
  return isRead
}

// The app's servers connect after the session starts, and a call that comes
// while the app has not yet confirmed which server serves the tool makes the
// app ask the person for permission, whatever the permission mode. So the
// first read waits ten seconds and is made once; if it fails, it is made again
// as the first turn starts, when the servers are surely confirmed.
const SESSION_DELAY_MS = 10_000
let isStartPending = false

// The tools that change what the app's servers report: Remote Control, the
// worktree, the folder and the connectors. A turn that used none of them
// leaves the servers' answer as it was.
const SESSION_TOOLS = /^(mcp__ccd_(session_mgmt|connectors|directory)__|EnterWorktree$|ExitWorktree$)/
let isInTurn = false
let isSessionTouched = false

async function loadSessionAtStart($: EngineInterface): Promise<void> {
  isStartPending = false
  await $.clock.sleep(SESSION_DELAY_MS)
  isStartPending = !(await loadSession($, false))
}

// Turns Remote Control on or off for this session, as the session bar's
// switch does, then reads the state back.
async function switchRemote($: EngineInterface, enabled: boolean): Promise<void> {
  await setSession($, view => ({ ...view, isSwitching: true, remoteError: undefined }))
  let remote: Remote | undefined
  let remoteError: string | undefined
  try {
    const result = await $.mcp.call(SESSIONS_SERVER, REMOTE_TOOL, { session_id: 'self', enabled })
    if (result.isError) remoteError = textOf(result.content) || 'el cambio fue rechazado'
    else remote = parseRemote(result.content)
  } catch (err) {
    remoteError = errorText(err)
  }
  await setSession($, view => ({ ...view, isSwitching: false, ...(remote ? { remote } : {}), remoteError }))
  if (!remoteError) {
    $.ui.toast(enabled ? 'Control remoto activado.' : 'Control remoto desactivado.')
    await loadSession($)
  }
}

// The folder fold's click: the native folder picker, then the session moves
// to the folder picked, as the app's own folder switch does.
async function changeFolder($: EngineInterface): Promise<void> {
  try {
    const picked = await $.mcp.call(DIRECTORY_SERVER, PICK_TOOL)
    const path = picked.isError ? undefined : pathOf(picked.content)
    if (!path) {
      if (picked.isError) $.ui.toast(`No pude abrir el selector de carpetas: ${textOf(picked.content)}`)
      return
    }
    const moved = await $.mcp.call(DIRECTORY_SERVER, MOVE_TOOL, { path })
    if (moved.isError) {
      $.ui.toast(`No pude cambiar a ${path}: ${textOf(moved.content)}`)
      return
    }
    $.ui.toast(`Carpeta de trabajo: ${path}`)
    await setSession($, view => ({ ...view, cwd: path }))
  } catch (err) {
    $.ui.toast(`No pude cambiar la carpeta: ${errorText(err)}`)
  }
}

// "Actualizar rama": a git pull -r of the checked-out branch, its own commits
// replayed over the remote's; a pull git refuses (a conflict, uncommitted
// changes) shows its reason. The mod runs git itself, so the app asks no
// permission. Then the session and the libraries are read again: the pull may
// bring other versions.
const PULL_MS = 120_000

async function pullBranch($: EngineInterface): Promise<void> {
  if ((await read($, pull)).status === 'running') return
  await update($, pull, () => ({ status: 'running' }) as Pull)
  const branch = (await read($, session)).branch
  try {
    const ran = await runCommand($, ['git', 'pull', '-r'], PULL_MS)
    const value: Pull =
      ran.exitCode === 0
        ? { status: 'done', text: `Rama ${branch || 'actual'} actualizada: ${pullSummary(ran.stdout)}` }
        : { status: 'failed', message: tail(ran.stderr || ran.stdout) || `git pull terminó con código ${ran.exitCode}` }
    await update($, pull, () => value)
  } catch (err) {
    await update($, pull, () => ({ status: 'failed', message: errorText(err) }) as Pull)
  }
  void loadSession($, true, false).catch(() => undefined)
  if ((await read($, pull)).status === 'done') void runScan($, true).catch(() => undefined)
}

// The branch's click: a new tab in the app's Terminal panel, in the session's
// folder, named after the branch.
async function openTerminal($: EngineInterface, view: SessionView): Promise<void> {
  try {
    const args: Record<string, unknown> = { title: view.branch || 'terminal' }
    if (view.cwd) args.cwd = view.cwd
    const opened = await $.mcp.call(TERMINAL_SERVER, TERMINAL_TOOL, args)
    if (opened.isError) $.ui.toast(`No pude abrir la terminal: ${textOf(opened.content)}`)
  } catch (err) {
    $.ui.toast(`No pude abrir la terminal: ${errorText(err)}`)
  }
}

// The project's root, where its list lives: git's top level, else the
// session's folder. Forward slashes, so a path joins the same on any system.
async function projectRoot($: EngineInterface, cwd?: string): Promise<string> {
  const top = await $.process
    .run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: GIT_MS, ...(cwd ? { cwd } : {}) })
    .then(r => (r.exitCode === 0 ? r.stdout.trim() : ''))
    .catch(() => '')
  const root = top || cwd || (await $.session.cwd().catch(() => '.'))
  return root.replace(/\\/g, '/').replace(/\/$/, '')
}

// Keeps a project's list out of git through its local exclude file; a folder
// that is no repository has nothing to keep it out of.
async function excludeTodos($: EngineInterface, root: string): Promise<void> {
  const ran = await $.process.run(['git', 'rev-parse', '--git-path', 'info/exclude'], { timeoutMs: GIT_MS, cwd: root }).catch(() => undefined)
  if (!ran || ran.exitCode !== 0) return
  const rel = ran.stdout.trim().replace(/\\/g, '/')
  const path = /^([A-Za-z]:)?\//.test(rel) ? rel : `${root}/${rel}`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const next = withExclude(text)
  if (next !== undefined) await $.fs.write(path, next)
}

// A list file as it stands: its tasks, or why it cannot be read and its text.
async function readTodoFile($: EngineInterface, root: string): Promise<{ tasks: Task[] } | { error: string; text: string }> {
  const path = `${root}/${TODO_FILE}`
  if (!(await $.fs.exists(path))) return { tasks: [] }
  const text = await $.fs.read(path)
  const file = parseTodoFile(text)
  return 'error' in file ? { error: file.error, text } : file
}

// What the pane says about a list it cannot read: it is left untouched.
const unreadable = (error: string) =>
  `${TODO_FILE} no se puede leer (${error}). No lo toco: corrígelo, o añade una tarea y guardaré una copia del archivo antes de empezar una lista nueva.`

// One change to a list at a time within this session, each on the file as it
// stands now. A damaged file is copied aside before a new list replaces it,
// so no task is lost to it. Keeping the list out of git is a side concern:
// its failure never stops the save.
let todoChain: Promise<unknown> = Promise.resolve()

function changeTodos<T>($: EngineInterface, root: string, fn: (tasks: Task[]) => { tasks: Task[]; value: T }): Promise<{ value: T; notice?: string }> {
  const run = todoChain.then(async () => {
    const file = await readTodoFile($, root)
    let notice: string | undefined
    if ('error' in file) {
      const copy = damagedPath(Date.now())
      await $.fs.write(`${root}/${copy}`, file.text)
      notice = `${TODO_FILE} estaba dañado (${file.error}): guardé una copia en ${copy} y empecé una lista nueva.`
    }
    const { tasks, value } = fn('error' in file ? [] : file.tasks)
    await excludeTodos($, root).catch(() => undefined)
    await $.fs.write(`${root}/${TODO_FILE}`, serializeTodos(tasks))
    if (root === (await projectRoot($))) await update($, todos, () => ({ isLoaded: true, tasks, ...(notice ? { notice } : {}) }))
    return notice ? { value, notice } : { value }
  })
  todoChain = run.catch(() => undefined)
  return run
}

async function loadTodos($: EngineInterface): Promise<Task[]> {
  try {
    const file = await readTodoFile($, await projectRoot($))
    if ('error' in file) {
      await update($, todos, () => ({ isLoaded: true, tasks: [], error: unreadable(file.error) }))
      return []
    }
    await update($, todos, () => ({ isLoaded: true, tasks: file.tasks }))
    return file.tasks
  } catch (err) {
    await update($, todos, () => ({ isLoaded: true, tasks: [], error: `No pude leer ${TODO_FILE}: ${errorText(err)}` }))
    return []
  }
}

async function addTodo($: EngineInterface, name: string, content?: string, root?: string): Promise<{ value: Task; notice?: string }> {
  const task = newTask(name, content, Date.now(), Math.random())
  return changeTodos($, root ?? (await projectRoot($)), tasks => ({ tasks: [...tasks, task], value: task }))
}

async function finishTodo($: EngineInterface, ref: string): Promise<{ value: Task | undefined; notice?: string }> {
  return changeTodos($, await projectRoot($), tasks => {
    const done = findTask(tasks, ref)
    return { tasks: done ? tasks.filter(t => t !== done) : tasks, value: done }
  })
}

// The folder a template's name points to: an absolute path as given, else a
// folder beside this project. Says why when there is none or several.
async function templateDir($: EngineInterface, template: string): Promise<{ dir: string } | { error: string }> {
  const given = template.trim().replace(/\\/g, '/').replace(/\/$/, '')
  if (/^([A-Za-z]:)?\//.test(given)) return (await $.fs.exists(given)) ? { dir: given } : { error: `No folder at ${given}.` }
  const root = await projectRoot($)
  const parent = root.replace(/\/[^/]+$/, '')
  const entries = await $.fs.list(parent).catch(() => undefined)
  if (!entries) return { error: `Could not list ${parent}. Ask the user for the template's absolute path.` }
  const folders = entries.filter(f => f.kind === 'dir').map(f => f.name)
  const found = templateMatches(folders, given)
  if (found.length === 1) return { dir: `${parent}/${found[0]}` }
  if (found.length === 0) return { error: `No folder named like "${given}" in ${parent}. Ask the user which template it is.` }
  return { error: `Several folders in ${parent} match "${given}": ${found.join(', ')}. Ask the user which one.` }
}

// A tool's answer as the engine takes it from a tool.call hook: the text as
// the result, or, for an error, as a refusal the model reads as an error
// result. An MCP-style { content, isError } object is refused by the engine.
type ToolAnswer = { result: string } | { deny: string }
const toolText = (text: string, isError = false): ToolAnswer => (isError ? { deny: text } : { result: text })

// A tool's answer, with any failure on the way (a file that cannot be read or
// written) turned into an error Claude can read and tell the user about.
async function answered(fn: () => Promise<ToolAnswer>): Promise<ToolAnswer> {
  try {
    return await fn()
  } catch (err) {
    return toolText(`The Pendientes list could not be changed: ${errorText(err)}`, true)
  }
}

const withNotice = (text: string, notice?: string) => (notice ? `${text} Note for the user: ${notice}` : text)

// Claude's tools over the list: behind ToolSearch, so they cost nothing
// until used. A failure here leaves the rest of the pane untouched.
async function registerTools($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: TOOL_LIST,
    description: "List this project's pending tasks (the Narsil Check pane's Pendientes): id, name and content of each.",
  })
  await $.tool.register({
    name: TOOL_ADD,
    description: "Add a task to this project's Pendientes list in the Narsil Check pane. Use it when the user asks to note something to do later.",
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Short task name' }, content: { type: 'string', description: 'Optional details' } }, required: ['name'] },
  })
  await $.tool.register({
    name: TOOL_DONE,
    description: "Remove a finished task from this project's Pendientes list. Call it when you complete a task that is on the list.",
    inputSchema: { type: 'object', properties: { task: { type: 'string', description: 'The task id, or its exact name' } }, required: ['task'] },
  })
  await $.tool.register({
    name: TOOL_TEMPLATE,
    description: "Add a task to the Pendientes list of another project, usually the template this project was created from (e.g. backendTemplate). `template` is that project's folder name (a folder beside this project) or its absolute path.",
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Folder name beside this project, or absolute path' },
        name: { type: 'string', description: 'Short task name' },
        content: { type: 'string', description: 'What to do and how it was done here: changes, files, problems and fixes' },
      },
      required: ['template', 'name'],
    },
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: COMMAND_HELP, argumentHint: 'upgrade | vulns | template "…"' })
    void registerTools($).catch(() => undefined)
    // Pendientes opens when it holds something.
    void loadTodos($)
      .then(tasks => update($, isTodosOpen, () => tasks.length > 0))
      .catch(() => undefined)
    // Every session starts the same: Entorno open, Conectores folded, and
    // Actualizaciones and Vulnerabilidades folded until they find something.
    await update($, isEnvOpen, () => true)
    await update($, isConnectorsOpen, () => false)
    await update($, isUpgradeOpen, () => false)
    await update($, isVulnsOpen, () => false)
    void loadSessionAtStart($).catch(() => undefined)
    // Opens on every session: it stands in for the app's session bar.
    await $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    if ((await detected($)).length > 0) void runScan($).catch(() => undefined)
    return next(e)
  })

  // Each main turn may switch the branch, the folder or Remote Control: the
  // session is read again as it ends, without holding the turn up.
  // The app's servers are asked again only when the turn used a tool that
  // changes their answer, or when they could not be read before.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isInTurn = true
      isSessionTouched = false
      if (isStartPending) {
        isStartPending = false
        void loadSession($).catch(() => undefined)
      }
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (isInTurn && SESSION_TOOLS.test(e.tool)) isSessionTouched = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      isInTurn = false
      const view = await read($, session)
      const withServers = isSessionTouched || Boolean(view.remoteError || view.connectorsError)
      isSessionTouched = false
      void loadSession($, true, withServers).catch(() => undefined)
    }
    return result
  })

  // /narsil-check <check>, as /narsil <option>: each check by name, and the
  // list of them for anything else.
  on('tool.call', { tool: `mcp__narsil-check__${TOOL_LIST}` }, async $ =>
    answered(async () => {
      const file = await readTodoFile($, await projectRoot($))
      return 'error' in file ? toolText(`${TODO_FILE} cannot be read (${file.error}). Tell the user; a change will keep a copy of it and start a new list.`, true) : toolText(todosText(file.tasks))
    }),
  )

  on('tool.call', { tool: `mcp__narsil-check__${TOOL_ADD}` }, async ($, e) =>
    answered(async () => {
      const input = e as unknown as { name?: unknown; content?: unknown }
      if (typeof input.name !== 'string' || !input.name.trim()) return toolText('A task needs a name.', true)
      const { value: task, notice } = await addTodo($, input.name, typeof input.content === 'string' ? input.content : undefined)
      return toolText(withNotice(`Added [${task.id}] ${task.name}.`, notice))
    }),
  )

  on('tool.call', { tool: `mcp__narsil-check__${TOOL_DONE}` }, async ($, e) =>
    answered(async () => {
      const ref = (e as unknown as { task?: unknown }).task
      if (typeof ref !== 'string' || !ref.trim()) return toolText('Name the task by its id or name.', true)
      const { value: done, notice } = await finishTodo($, ref)
      return done ? toolText(withNotice(`Removed [${done.id}] ${done.name}.`, notice)) : toolText(withNotice(`No pending task "${ref}". Call ${TOOL_LIST} to see them.`, notice), true)
    }),
  )

  on('tool.call', { tool: `mcp__narsil-check__${TOOL_TEMPLATE}` }, async ($, e) =>
    answered(async () => {
      const input = e as unknown as { template?: unknown; name?: unknown; content?: unknown }
      if (typeof input.template !== 'string' || !input.template.trim()) return toolText('Name the template folder.', true)
      if (typeof input.name !== 'string' || !input.name.trim()) return toolText('A task needs a name.', true)
      const found = await templateDir($, input.template)
      if ('error' in found) return toolText(found.error, true)
      const { value: task, notice } = await addTodo($, input.name, typeof input.content === 'string' ? input.content : undefined, found.dir)
      return toolText(withNotice(`Added [${task.id}] ${task.name} to ${found.dir}/${TODO_FILE}.`, notice))
    }),
  )

  on('command.run', { command: COMMAND }, async ($, e) => {
    // /narsil-check template "<text>": Claude finds the template and writes
    // the task, since only Claude knows how the work here was done.
    const request = templateArg(e.args)
    if (request !== undefined) {
      if (!request) return { text: 'Narsil Check: escribe la tarea entre comillas, por ejemplo /narsil-check template "en backendTemplate crea la tarea de actualizar TypeScript a 7.0.0, explica lo que hicimos".' }
      void $.clock
        .sleep(0)
        .then(() => $.prompt.submit({ text: templatePrompt(request) }))
        .catch(err => $.ui.toast(`No pude pasarle la tarea a Claude: ${errorText(err)}`))
      return { text: 'Narsil Check: le paso la tarea a Claude para la plantilla.' }
    }
    const arg = e.args.trim().toLowerCase().replace(/\s+/g, ' ')
    if (arg === 'upgrade') {
      await update($, isUpgradeOpen, () => true)
      await $.ui.open({ id: PANE, title: TITLE })
      void runScan($, true).catch(() => undefined)
      return { text: 'Narsil Check: revisando las librerías del proyecto.' }
    }
    if (arg === 'vulns' || arg === 'vulnerabilidades') {
      await update($, isVulnsOpen, () => true)
      await $.ui.open({ id: PANE, title: TITLE })
      void runAudit($).catch(() => undefined)
      return { text: 'Narsil Check: buscando vulnerabilidades en OSV.dev.' }
    }
    return { text: commandHelp(arg) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    // The terminal draws no SVG: baby Narsil shows on the other surfaces.
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    // The mobile app draws no text field: there tasks are added through Claude.
    const Input = e.surface !== 'mobile' && 'Input' in elements ? elements.Input : undefined
    const state = await read($, scan)
    const work = await read($, job)
    const waiting = await read($, pending)
    const request = await read($, pr)
    const explained = await read($, reasons)
    const refresh = () => runScan($, true)
    const upgrade = () => upgradeBumps($)
    const ship = () => publish($)
    const note = jobNote(work)
    const prText = prNote(request)
    const isOpen = await read($, isUpgradeOpen)
    const toggle = async () => {
      await update($, isUpgradeOpen, value => !value)
    }

    // The pane's own head, as Narsil's band: a colored dot and its name,
    // centered across the pane.
    const head = (
      <Box key="head" flexDirection="row" justifyContent="center">
        <Text bold color={PALETTE.info}>
          ● Narsil Check
        </Text>
      </Box>
    )
    const picture = Svg ? (
      <Box key="narsil" flexDirection="row" justifyContent="center">
        <Svg source={narsilSvg(PARADA_CLARO, PARADA_OSCURO)} alt="Narsil bebé" width={NARSIL_SIZE.width} height={NARSIL_SIZE.height} />
      </Box>
    ) : null
    // The upgrade section's head: a toggle, its name in the color of what
    // most needs you, and its count when it has one.
    const color = sectionColor(state)
    const section = (
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text bold color={color}>
          ●
        </Text>
        <Button key="section-upgrade" plain label={sectionLabel(isOpen, state)} onPress={toggle} />
      </Box>
    )
    // The session section, first: what the app's session bar shows. Each
    // fold reads the session again as it opens.
    const view = await read($, session)
    const envOpen = await read($, isEnvOpen)
    const connectorsOpen = await read($, isConnectorsOpen)
    const toggleEnv = async () => {
      const open = await update($, isEnvOpen, value => !value)
      if (open) await loadSession($)
    }
    const toggleConnectors = async () => {
      const open = await update($, isConnectorsOpen, value => !value)
      if (open) await loadSession($)
    }
    const up = connected(view)
    const down = view.connectors.filter(c => c.status !== 'connected')
    const knob = switchGlyph(view)
    const sessionSection = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text bold color={view.isLoaded ? PALETTE.info : PALETTE.muted}>
            ●
          </Text>
          <Button key="section-env" plain label={envLabel(envOpen)} onPress={toggleEnv} />
        </Box>
        {envOpen && (
          <Box flexDirection="column">
            {!view.isLoaded ? (
              <Text dimColor>Leyendo la sesión…</Text>
            ) : (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>Repositorio</Text>
                  {view.repository ? <Link href={view.repository} label={repositoryLabel(view.repository)} /> : <Text dimColor>sin repositorio remoto</Text>}
                </Box>
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>Carpeta</Text>
                  <Button key="env-folder" plain label={view.cwd || 'elegir carpeta'} onPress={() => changeFolder($)} />
                </Box>
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>Rama</Text>
                  <Button key="env-branch" plain label={view.branch || 'sin git'} onPress={() => openTerminal($, view)} />
                </Box>
                {view.worktree && (
                  <Text dimColor wrap="truncate-start">
                    worktree {view.worktree}
                  </Text>
                )}
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>Control remoto</Text>
                  <Text bold color={knob.color}>
                    {knob.knob}
                  </Text>
                  {!view.isSwitching && (view.remote === 'on' || view.remote === 'off' || view.remote === 'connecting') ? (
                    <Button key="remote-switch" plain label={knob.word} onPress={() => switchRemote($, view.remote === 'off')} />
                  ) : (
                    <Text dimColor>{knob.word}</Text>
                  )}
                </Box>
                {view.remoteError && <Text color={PALETTE.error}>No pude leer o cambiar el control remoto: {view.remoteError}</Text>}
              </Box>
            )}
          </Box>
        )}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text bold color={connectorsColor(view)}>
            ●
          </Text>
          <Button key="section-connectors" plain label={connectorsLabel(connectorsOpen, view)} onPress={toggleConnectors} />
        </Box>
        {connectorsOpen && (
          <Box flexDirection="column">
            {!view.isLoaded ? (
              <Text dimColor>Leyendo los conectores…</Text>
            ) : view.connectorsError ? (
              <Text color={PALETTE.error}>No pude leer los conectores: {view.connectorsError}</Text>
            ) : up.length === 0 ? (
              <Text dimColor>No hay conectores conectados.</Text>
            ) : (
              <Box flexDirection="column">
                {[...up, ...down].map(c => (
                  <Text>
                    <Text color={c.status === 'connected' ? PALETTE.done : PALETTE.waiting}>● </Text>
                    {connectorLine(c)}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>
    )

    // The vulnerabilities section: its own toggle and body, under upgrades.
    const found = await read($, audit)
    // How many of a declared package's vulnerabilities its upgrade fixes.
    const direct = new Map(found.status === 'done' ? found.findings.filter(f => f.isDirect).map(f => [`${f.ecosystem}:${f.name}`, f]) : [])
    const fixes = (u: Upgrade) => fixedBy(direct.get(`${u.ecosystem}:${u.name}`), u.latest)
    const vulnsOpen = await read($, isVulnsOpen)
    const closed = new Set(await read($, closedGroups))
    const toggleVulns = async () => {
      await update($, isVulnsOpen, value => !value)
    }
    const vulnsSection = (
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text bold color={vulnsColor(found)}>
          ●
        </Text>
        <Button key="section-vulns" plain label={vulnsLabel(vulnsOpen, found)} onPress={toggleVulns} />
      </Box>
    )
    const vulnsBody = (() => {
      if (found.status === 'idle' || found.status === 'scanning') return <Text dimColor>Buscando vulnerabilidades en OSV.dev…</Text>
      if (found.status === 'error') {
        return (
          <Box flexDirection="column">
            <Text color={PALETTE.error}>No pude consultar OSV.dev: {found.message}</Text>
            <Button key="vulns-retry" onPress={() => runAudit($)}>
              Reintentar
            </Button>
          </Box>
        )
      }
      if (found.findings.length === 0) return <Text color={PALETTE.done}>{auditSummary(found.findings, found.checked)}</Text>
      return (
        <Box flexDirection="column">
          <Text bold>{auditSummary(found.findings, found.checked)}</Text>
          <Text dimColor>{agoLabel(found.at, Date.now()).replace('revisado', 'consultado')} · fuente: OSV.dev</Text>
          {SEVERITIES.map(severity => {
            const rows = bySeverity(found.findings, severity)
            if (rows.length === 0) return undefined
            const tone = SEVERITY_COLOR[severity]
            const key = `vulns-${severity}`
            const isShut = closed.has(key)
            return (
              <Box flexDirection="column" marginTop={1}>
                <Box flexDirection="row" gap={1}>
                  <Text color={tone}>●</Text>
                  <Button key={`group-${key}`} plain label={groupLabel(!isShut, SEVERITY_TITLE[severity], rows.length)} onPress={() => toggleGroup($, key)} />
                </Box>
                {!isShut && rows.map(({ finding, vuln }) => (
                  <Box flexDirection="column">
                    <Button key={`vuln-${finding.ecosystem}:${finding.name}@${finding.version}:${vuln.id}`} plain label={`${finding.display ?? finding.name} ${finding.version}${finding.isDirect ? '' : ' · indirecta'} · ${vuln.id}`} onPress={press => copyRow($, vulnCopyText(finding, vuln), press.surface)} />
                    <Text dimColor wrap="truncate-end">
                      {'  '}
                      {vuln.summary}
                    </Text>
                    <Text color={vuln.fixed ? PALETTE.done : PALETTE.muted}>
                      {'  '}
                      {vuln.fixed ? `Se corrige en ${vuln.fixed}` : 'Sin versión que la corrija'}
                    </Text>
                  </Box>
                ))}
              </Box>
            )
          })}
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Text dimColor>➜</Text>
            <Button key="vulns-refresh" onPress={() => runAudit($)}>
              Consultar de nuevo
            </Button>
          </Box>
        </Box>
      )
    })()

    // Pendientes, last: ○ finishes a task, its name shows or hides its content,
    // and the field adds one as "nombre: contenido".
    const list = await read($, todos)
    const todosOpen = await read($, isTodosOpen)
    const shown = new Set(await read($, openTodos))
    const toggleTodos = async () => {
      const open = await update($, isTodosOpen, value => !value)
      if (open) await loadTodos($)
    }
    const toggleTask = (id: string) => update($, openTodos, ids => (ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]))
    const finish = async (id: string) => {
      await finishTodo($, id).catch(err => $.ui.toast(`No pude guardar Pendientes: ${errorText(err)}`))
      await update($, openTodos, ids => ids.filter(i => i !== id))
    }
    const add = async (text: string) => {
      const entry = parseEntry(text)
      if (!entry) return
      await addTodo($, entry.name, entry.content).catch(err => $.ui.toast(`No pude guardar Pendientes: ${errorText(err)}`))
    }
    const todosSection = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text bold color={todosColor(list.tasks.length)}>
            ●
          </Text>
          <Button key="section-todos" plain label={todosLabel(todosOpen, list.tasks.length)} onPress={toggleTodos} />
        </Box>
        {todosOpen && (
          <Box flexDirection="column">
            {list.error && <Text color={PALETTE.error}>{list.error}</Text>}
            {list.notice && <Text color={PALETTE.waiting}>{list.notice}</Text>}
            {list.tasks.map(t => (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Button key={`todo-done-${t.id}`} plain label="○" onPress={() => finish(t.id)} />
                  {t.content ? (
                    <Button key={`todo-${t.id}`} plain label={`${shown.has(t.id) ? '▾' : '▸'} ${t.name}`} onPress={() => toggleTask(t.id)} />
                  ) : (
                    <Text>{t.name}</Text>
                  )}
                </Box>
                {t.content && shown.has(t.id) && (
                  <Box marginLeft={4}>
                    <Text dimColor>{t.content}</Text>
                  </Box>
                )}
              </Box>
            ))}
            {Input && <Input key="todo-new" placeholder="Nueva tarea (nombre: contenido)" submitLabel="Agregar" value="" onSubmit={(text: string) => add(text)} />}
            {!Input && list.tasks.length === 0 && <Text dimColor>No hay tareas pendientes.</Text>}
          </Box>
        )}
      </Box>
    )

    // "Actualizar rama", last of all: a git pull of the checked-out branch.
    const pulled = await read($, pull)
    const pullSection = (
      <Box flexDirection="column" marginTop={1}>
        {pulled.status === 'done' && <Text color={PALETTE.done}>{pulled.text}</Text>}
        {pulled.status === 'failed' && <Text color={PALETTE.error}>No pude actualizar la rama: {pulled.message}</Text>}
        <Box flexDirection="row" gap={1}>
          <Text dimColor>➜</Text>
          {pulled.status === 'running' ? <Text dimColor>Actualizando la rama…</Text> : <Button key="branch-pull" onPress={() => pullBranch($)}>Actualizar rama</Button>}
        </Box>
      </Box>
    )

    const frame = (body: JSX.Element) => (
      <Box flexDirection="column">
        {head}
        {picture}
        {sessionSection}
        {section}
        {isOpen ? body : null}
        {vulnsSection}
        {vulnsOpen ? vulnsBody : null}
        {todosSection}
        {pullSection}
      </Box>
    )

    if (state.status === 'idle' || state.status === 'scanning') {
      return frame(<Text dimColor>Buscando actualizaciones…</Text>)
    }
    if (state.status === 'none') {
      return frame(
        <Box flexDirection="column">
          <Text>No encontré dependencias que revisar en este proyecto.</Text>
          <Text dimColor>Reviso npm y Expo (package.json), PyPI (pyproject.toml, requirements.txt), Go (go.mod), Cargo (Cargo.toml), Pub (pubspec.yaml), Gradle y Maven (libs.versions.toml, build.gradle.kts, pom.xml), NuGet (.csproj), RubyGems (Gemfile) y SwiftPM (Package.swift, proyectos de Xcode).</Text>
        </Box>,
      )
    }
    if (state.status === 'error') {
      return frame(
        <Box flexDirection="column">
          <Text color={PALETTE.error}>No pude revisar las librerías: {state.message}</Text>
          <Button onPress={refresh}>Reintentar</Button>
        </Box>,
      )
    }

    const notes = [heldNote(state.held), failedNote(state.failed)].filter(n => n !== undefined)
    return frame(
      <Box flexDirection="column">
        <Text bold>{summaryOf(state.upgrades, state.checked)}</Text>
        <Text dimColor>{agoLabel(state.at, Date.now())}</Text>
        {note && <Text color={note.color}>{note.text}</Text>}
        {(waiting.changes.length > 0 || request.status !== 'idle') && (
          <Box flexDirection="column" marginTop={1}>
            {waiting.changes.length > 0 && (
              <Box flexDirection="row" gap={1}>
                <Text color={PALETTE.info}>●</Text>
                <Text bold color={PALETTE.info}>
                  {pendingLabel(waiting.changes.length)}
                </Text>
              </Box>
            )}
            {waiting.changes.map(c => (
              <Text dimColor>
                {c.name} {c.from} → {c.to}
              </Text>
            ))}
            {prText && <Text color={prText.color}>{prText.text}</Text>}
            {request.status === 'done' && request.url && <Link href={request.url} label={request.url} />}
            {waiting.changes.length > 0 && request.status !== 'running' && (
              <Box marginTop={1}>
                <Button key="publish-pr" variant="primary" onPress={ship}>
                  {publishLabel(waiting.branch, waiting.isMain)}
                </Button>
              </Box>
            )}
          </Box>
        )}
        {GROUPS.map(g => {
          // An upgrade that fixes vulnerabilities goes first in its group.
          const rows = state.upgrades.filter(u => u.group === g.group).sort((a, b) => fixes(b) - fixes(a))
          if (rows.length === 0) return undefined
          const key = `upgrade-${g.group}`
          const isShut = closed.has(key)
          return (
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Text color={g.color}>●</Text>
                <Button key={`group-${key}`} plain label={groupLabel(!isShut, g.label, rows.length)} onPress={() => toggleGroup($, key)} />
              </Box>
              {!isShut && <Text dimColor>{g.hint}</Text>}
              {!isShut && rows.map(u => {
                const why = g.group === 'review' ? explained[reasonKey(u)] : undefined
                const line = g.group === 'blocked' ? { text: u.conflicts.join(' · '), color: PALETTE.error, isDim: false } : reasonLine(why)
                const copy = upgradeCopyText(u, why?.status === 'done' ? why : undefined)
                return (
                  <Box flexDirection="column">
                    <Button key={`upgrade-${u.ecosystem}:${u.name}`} plain label={upgradeLine(u, state.ecosystems.length > 1 ? adapterOf(u.ecosystem).label : undefined, fixes(u))} onPress={press => copyRow($, copy, press.surface)} />
                    {line && (
                      <Text color={line.color} dimColor={line.isDim}>
                        {'  '}
                        {line.text}
                      </Text>
                    )}
                  </Box>
                )
              })}
              {g.group === 'bump' && work.status !== 'running' && (
                <Box marginTop={1}>
                  <Button key="upgrade-bumps" variant="primary" onPress={upgrade}>
                    {rows.length === 1 ? 'Actualizar esta librería' : `Actualizar las ${rows.length}`}
                  </Button>
                </Box>
              )}
            </Box>
          )
        })}
        {notes.map(n => (
          <Text dimColor>{n}</Text>
        ))}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text dimColor>➜</Text>
          <Button onPress={refresh}>Revisar de nuevo</Button>
        </Box>
      </Box>,
    )
  })
}

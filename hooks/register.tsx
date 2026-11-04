import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Explained, Group, Job, Pending, Pr, Scan, Upgrade } from '../types'
import {
  NOTES_PER_RELEASE,
  NOTES_TOTAL,
  SYSTEM,
  breakingVersions,
  changelogSince,
  changelogUrl,
  clip,
  copyText,
  importPattern,
  parseReason,
  prompt,
  reasonKey,
  releaseTags,
  releaseUrl,
  repoOf,
} from './explain'
import type { Reason } from './explain'
import { branchName, changesOf, commitBody, commitTitle, isMainBranch, prBody, prUrlOf } from './git'
import { EXPO_TABLE, LOCK, LOCKFILES, MANIFEST, expoTableUrl, installArgv, installedFromManifest, installedOf, latestOf, latestUrl, managerOf, parseManifest, peerConflicts, pinConflicts, upgradeOf, versionUrl } from './npm'
import type { Declared, Found, Installed } from './npm'
import { parseVersion, show } from './semver'
import { COMMAND, GROUPS, PANE, TITLE, agoLabel, failedNote, heldNote, jobNote, pendingLabel, pool, prNote, publishLabel, reasonLine, sortUpgrades, summaryOf, tail } from './words'

// Change a tag when its type's fields change: it declines what an earlier
// version stored, which outlives a reload.
const scan = atom({ plugin: 'upgrade-mod', key: 'scan' } as const, { status: 'idle' } as Scan, { shape: 'scan-3' })
const job = atom({ plugin: 'upgrade-mod', key: 'job' } as const, { status: 'idle' } as Job, { shape: 'job-1' })
const NO_PENDING: Pending = { changes: [], files: [], manager: 'npm', branch: '', isMain: false }
const pending = atom({ plugin: 'upgrade-mod', key: 'pending' } as const, NO_PENDING, { shape: 'pending-2' })
const pr = atom({ plugin: 'upgrade-mod', key: 'pr' } as const, { status: 'idle' } as Pr, { shape: 'pr-2' })
const reasons = atom({ plugin: 'upgrade-mod', key: 'reasons' } as const, {} as Record<string, Explained>, { shape: 'reasons-1' })

// Haiku reads each major jump once: its reading is kept in the store for good.
const EXPLAIN_CONCURRENCY = 2
const EXPLAIN_MS = 60_000

// An install may download a lot: the most $.process.run allows is ten minutes.
const INSTALL_MS = 10 * 60 * 1000
const GIT_MS = 2 * 60 * 1000

// A registry answer is reused for this long, across sessions and projects.
const CACHE_MS = 6 * 60 * 60 * 1000
const CONCURRENCY = 8

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

// The latest release on npm, from the store while it is fresh.
async function latestOnNpm($: EngineInterface, name: string, isFresh: boolean): Promise<string | undefined> {
  const key = `npm:${name}`
  const cached = (await $.store.get(key)) as Cached | undefined
  if (!isFresh && cached && Date.now() - cached.at < CACHE_MS) return cached.version
  const res = await $.http.fetch(latestUrl(name), { headers: { accept: 'application/json' } })
  if (!res.ok) return undefined
  const version = latestOf(res.text)
  if (version) await $.store.set(key, { version, at: Date.now() } satisfies Cached)
  return version
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
  const installed = await readJson($, `node_modules/${u.name}/package.json`)
  const manifest = repoOf(installed) ? installed : JSON.parse((await fetchText($, latestUrl(u.name))) ?? '{}')
  const repo = repoOf(manifest)
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
  if (parts.length === 0) {
    const changelog = await fetchText($, changelogUrl(u.name, u.latest))
    if (changelog) parts.push(changelogSince(changelog, u.current))
  }
  return clip(parts.join('\n\n'), NOTES_TOTAL)
}

// Where the project imports the library: the files and their import lines.
async function usageOf($: EngineInterface, name: string): Promise<{ files: number; lines: string[] }> {
  try {
    const ran = await $.process.run(['git', '--no-pager', 'grep', '-n', '-I', '-E', importPattern(name), '--', '.', ':!node_modules'], { timeoutMs: GIT_MS })
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
  const [notes, usage] = await Promise.all([releaseNotes($, u), usageOf($, u.name)])
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

// Puts the major upgrades and their reasons on the clipboard of the surface
// the press came from.
async function copyGroup($: EngineInterface, group: Group, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']): Promise<void> {
  const state = await read($, scan)
  if (state.status !== 'done') return
  const known = await read($, reasons)
  const done: Record<string, Reason | undefined> = {}
  for (const [key, value] of Object.entries(known)) if (value.status === 'done') done[key] = value
  const copied = await $.ui.copy({ text: copyText(state.upgrades.filter(u => u.group === group), done), surface })
  $.ui.toast(copied.isCopied ? 'Copié las librerías con sus razones.' : `No pude copiar: ${copied.reason}`)
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

// The SDK's table of native module ranges: the installed copy, else the one
// published with the installed Expo version.
async function expoTable($: EngineInterface, expo: string | undefined): Promise<Record<string, string> | undefined> {
  const local = await readJson($, EXPO_TABLE)
  if (local && typeof local === 'object') return local as Record<string, string>
  if (!expo) return undefined
  const res = await $.http.fetch(expoTableUrl(expo))
  return res.ok ? (JSON.parse(res.text) as Record<string, string>) : undefined
}

function setScan($: EngineInterface, value: Scan): Promise<Scan> {
  return update($, scan, () => value)
}

let running: Promise<void> | undefined

// One scan at a time: a second request while one runs waits for it.
function runScan($: EngineInterface, isFresh = false): Promise<void> {
  running ??= scanProject($, isFresh).finally(() => {
    running = undefined
  })
  return running
}

async function scanProject($: EngineInterface, isFresh: boolean): Promise<void> {
  if (!(await $.fs.exists(MANIFEST))) {
    await setScan($, { status: 'none' })
    return
  }
  await setScan($, { status: 'scanning' })
  try {
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
        const latest = await latestOnNpm($, d.name, isFresh)
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
        u.conflicts = [...own, ...pinConflicts(u.name, version, lock, batch)]
        const group = u.conflicts.length > 0 ? 'blocked' : u.bump === 'major' ? 'review' : 'bump'
        if (group !== u.group) {
          u.group = group
          changed = true
        }
      }
    }
    await setScan($, { status: 'done', upgrades: sortUpgrades(upgrades), held, checked: checked.length, failed, at: Date.now() })
    // Haiku reads the majors in the background: the list shows at once.
    void explainMajors($, upgrades).catch(() => undefined)
    await checkPending($)
  } catch (err) {
    await setScan($, { status: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

function setJob($: EngineInterface, value: Job): Promise<Job> {
  return update($, job, () => value)
}

// Runs a command. With no shell, Windows starts npm only by its .cmd shim,
// so a command that cannot start is tried again as one.
async function runCommand($: EngineInterface, argv: string[], timeoutMs = INSTALL_MS) {
  const [command, ...args] = argv
  try {
    return await $.process.run(argv, { timeoutMs })
  } catch (err) {
    try {
      return await $.process.run([`${command}.cmd`, ...args], { timeoutMs })
    } catch {
      throw err
    }
  }
}

// The upgraded ranges git shows uncommitted in package.json: what a PR
// would hold. Read from git, so it holds across sessions and for upgrades
// made by hand. Outside a git repository there is nothing pending.
async function checkPending($: EngineInterface): Promise<void> {
  let value = NO_PENDING
  try {
    const diff = await $.process.run(['git', '--no-pager', 'diff', '-U0', '--', MANIFEST], { timeoutMs: GIT_MS })
    const names = parseManifest(await $.fs.read(MANIFEST)).map(d => d.name)
    const changes = diff.exitCode === 0 ? changesOf(diff.stdout, names) : []
    if (changes.length > 0) {
      const lockfiles = LOCKFILES.map(([file]) => file)
      const status = await $.process.run(['git', 'status', '--porcelain', '--', MANIFEST, ...lockfiles], { timeoutMs: GIT_MS })
      // " M path": a tracked file changed in the worktree.
      const files = status.stdout
        .split(/\r?\n/)
        .filter(l => /^.M /.test(l) || /^M. /.test(l))
        .map(l => l.slice(3).trim())
      const branch = (await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: GIT_MS })).stdout.trim()
      const originHead = await $.process.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { timeoutMs: GIT_MS })
      const isMain = isMainBranch(branch, originHead.exitCode === 0 ? originHead.stdout : '')
      value = { changes, files: files.length > 0 ? files : [MANIFEST], manager: managerOf(files), branch, isMain }
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
  const present: string[] = []
  for (const [file] of LOCKFILES) if (await $.fs.exists(file)) present.push(file)
  const manager = managerOf(present)
  await setJob($, { status: 'running', manager, count: bumps.length })
  try {
    for (const argv of installArgv(manager, bumps)) {
      const ran = await runCommand($, argv)
      if (ran.exitCode !== 0) {
        await setJob($, { status: 'failed', message: `${argv.slice(0, 2).join(' ')} terminó con código ${ran.exitCode}: ${tail(ran.stderr || ran.stdout)}` })
        await runScan($, true)
        return
      }
    }
    await setJob($, { status: 'upgraded', count: bumps.length, at: Date.now() })
    $.ui.toast(`Actualicé ${bumps.length} ${bumps.length === 1 ? 'librería' : 'librerías'} con ${manager}.`)
  } catch (err) {
    await setJob($, { status: 'failed', message: `No pude ejecutar ${manager}: ${err instanceof Error ? err.message : String(err)}` })
  }
  await runScan($, true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Abre el panel con las librerías que se pueden actualizar' })
    // Opens by itself only when the scan finds something to upgrade; /upgrades
    // opens it any time.
    if (await $.fs.exists(MANIFEST)) {
      void runScan($).then(async () => {
        const state = await read($, scan)
        if (state.status === 'done' && state.upgrades.length > 0) await $.ui.open({ id: PANE, title: TITLE })
      }).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void runScan($, true).catch(() => undefined)
    return { text: 'Revisando las librerías del proyecto.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
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

    if (state.status === 'idle' || state.status === 'scanning') {
      return <Text dimColor>Buscando actualizaciones…</Text>
    }
    if (state.status === 'none') {
      return (
        <Box flexDirection="column">
          <Text>No encontré un package.json en este proyecto.</Text>
          <Text dimColor>Por ahora reviso npm (JavaScript y TypeScript) y Expo.</Text>
        </Box>
      )
    }
    if (state.status === 'error') {
      return (
        <Box flexDirection="column">
          <Text color="red">No pude revisar las librerías: {state.message}</Text>
          <Button onPress={refresh}>Reintentar</Button>
        </Box>
      )
    }

    const notes = [heldNote(state.held), failedNote(state.failed)].filter(n => n !== undefined)
    return (
      <Box flexDirection="column">
        <Text bold>{summaryOf(state.upgrades, state.checked)}</Text>
        <Text dimColor>{agoLabel(state.at, Date.now())}</Text>
        {note && <Text color={note.color}>{note.text}</Text>}
        {(waiting.changes.length > 0 || request.status !== 'idle') && (
          <Box flexDirection="column" marginTop={1}>
            {waiting.changes.length > 0 && <Text bold color="cyan">{pendingLabel(waiting.changes.length)}</Text>}
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
          const rows = state.upgrades.filter(u => u.group === g.group)
          if (rows.length === 0) return undefined
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color={g.color}>
                {g.label} ({rows.length})
              </Text>
              <Text dimColor>{g.hint}</Text>
              {(g.group === 'blocked' || g.group === 'review') && (
                <Box>
                  <Button key={g.group === 'blocked' ? 'copy-blocked' : 'copy-majors'} plain onPress={press => copyGroup($, g.group, press.surface)}>
                    Copiar con razones
                  </Button>
                </Box>
              )}
              {rows.map(u => {
                const why = g.group === 'review' ? explained[reasonKey(u)] : undefined
                const line = g.group === 'blocked' ? { text: u.conflicts.join(' · '), color: 'magenta', isDim: false } : reasonLine(why)
                return (
                  <Box flexDirection="column">
                    <Text>
                      {u.name} <Text dimColor>{u.current} → </Text>
                      {u.latest}
                      {u.isDev ? <Text dimColor> · dev</Text> : ''}
                    </Text>
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
        <Box marginTop={1}>
          <Button onPress={refresh}>Revisar de nuevo</Button>
        </Box>
      </Box>
    )
  })
}

import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { baseOf, bumpOf, parseVersion, satisfies } from '../hooks/semver'
import type { Version } from '../hooks/semver'
import { installArgv, installedFromManifest, isExactPin, latestUrl, managerOf, parseManifest, peerConflicts, pinConflicts, rangeFor, upgradeOf } from '../hooks/npm'
import type { Installed } from '../hooks/npm'
import { branchName, commitTitle, isMainBranch, prUrlOf } from '../hooks/git'
import { specChanges } from '../hooks/ecosystems'
import { sortUpgrades, summaryOf } from '../hooks/words'
import { breakingVersions, changelogSince, copyText, importPattern, parseReason, releaseTags, repoOf } from '../hooks/explain'

// The test runner has timers; the hooks environment's types do not declare them.
declare function setTimeout(fn: () => void, ms: number): unknown

const v = (text: string): Version => {
  const parsed = parseVersion(text)
  if (!parsed) throw new Error(`not a version: ${text}`)
  return parsed
}

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: {
    title: 'Narsil Check',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// A project on disk and a registry, standing for the engine beneath the mod.
function project(on: On, files: Record<string, string>, latest: Record<string, string>, opened: string[] = [], web: Record<string, string> = {}) {
  const store = new Map<string, unknown>()
  // The engine hands paths resolved against the working directory.
  const fileOf = (path: string) => {
    const at = path.replace(/\\/g, '/')
    const names = Object.keys(files).sort((a, b) => b.length - a.length)
    const key = names.find(name => at === name || at.endsWith(`/${name}`))
    return key === undefined ? undefined : files[key]
  }
  on('fs.exists', (_, e) => ({ value: fileOf(e.path) !== undefined }))
  on('fs.read', (_, e) => {
    const text = fileOf(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('http.fetch', (_, e) => {
    const page = web[e.url]
    if (page !== undefined) return { value: { status: 200, ok: true, headers: {}, text: page } }
    const name =decodeURIComponent(e.url.replace('https://registry.npmjs.org/', '').replace(/\/latest$/, ''))
    const version = latest[name]
    return {
      value: version
        ? { status: 200, ok: true, headers: {}, text: JSON.stringify({ version }) }
        : { status: 404, ok: false, headers: {}, text: '{}' },
    }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'upgrades' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return store
}

test('the jump between two versions', () => {
  expect(bumpOf(v('1.2.3'), v('1.2.4'))).toBe('patch')
  expect(bumpOf(v('1.2.3'), v('1.3.0'))).toBe('minor')
  expect(bumpOf(v('1.2.3'), v('2.0.0'))).toBe('major')
  expect(bumpOf(v('1.2.3'), v('1.2.3'))).toBe('none')
  expect(bumpOf(v('2.0.0'), v('1.9.0'))).toBe('none')
  // Below 1.0.0 a minor breaks, and below 0.1.0 a patch does.
  expect(bumpOf(v('0.3.1'), v('0.4.0'))).toBe('major')
  expect(bumpOf(v('0.3.1'), v('0.3.2'))).toBe('patch')
  expect(bumpOf(v('0.0.3'), v('0.0.4'))).toBe('major')
})

test('the version a range is written from', () => {
  expect(baseOf('^1.2.3')).toEqual(v('1.2.3'))
  expect(baseOf('~0.4.0')).toEqual(v('0.4.0'))
  expect(baseOf('>=2.0.0 <3')).toEqual(v('2.0.0'))
  expect(baseOf('workspace:*')).toBeUndefined()
  expect(baseOf('github:owner/repo')).toBeUndefined()
  expect(baseOf('latest')).toBeUndefined()
})

test('a version meets the ranges compatibility tables write', () => {
  expect(satisfies(v('58.0.5'), '~58.0.2')).toBe(true)
  expect(satisfies(v('58.1.0'), '~58.0.2')).toBe(false)
  expect(satisfies(v('15.4.0'), '^15.0.2')).toBe(true)
  expect(satisfies(v('16.0.0'), '^15.0.2')).toBe(false)
  expect(satisfies(v('0.3.9'), '^0.3.2')).toBe(true)
  expect(satisfies(v('0.4.0'), '^0.3.2')).toBe(false)
  expect(satisfies(v('2.2.0'), '2.2.0')).toBe(true)
  expect(satisfies(v('2.2.1'), '2.2.0')).toBe(false)
  expect(satisfies(v('3.1.0'), '>=3.0.0')).toBe(true)
})

test('package.json dependencies and devDependencies are both read', () => {
  const list = parseManifest(JSON.stringify({ dependencies: { react: '^18.2.0' }, devDependencies: { typescript: '~5.4.0' } }))
  expect(list).toEqual([
    { name: 'react', spec: '^18.2.0', isDev: false },
    { name: 'typescript', spec: '~5.4.0', isDev: true },
  ])
})

test('a scoped name keeps its @ in the registry address', () => {
  expect(latestUrl('@types/node')).toBe('https://registry.npmjs.org/@types%2Fnode/latest')
  expect(latestUrl('react')).toBe('https://registry.npmjs.org/react/latest')
})

test('each dependency lands in its group', () => {
  const declared = (name: string) => ({ name, spec: '^1.0.0', isDev: false })
  expect(upgradeOf({ declared: declared('a'), installed: v('1.0.0'), latest: v('1.0.1') })).toMatchObject({ group: 'bump', bump: 'patch' })
  expect(upgradeOf({ declared: declared('a'), installed: v('1.0.0'), latest: v('1.4.0') })).toMatchObject({ group: 'bump', bump: 'minor' })
  expect(upgradeOf({ declared: declared('a'), installed: v('1.0.0'), latest: v('2.0.0') })).toMatchObject({ group: 'review', bump: 'major' })
  expect(upgradeOf({ declared: declared('a'), installed: v('1.0.0'), latest: v('1.0.0') })).toBeUndefined()
  expect(upgradeOf({ declared: declared('a'), installed: v('1.0.0') })).toBeUndefined()
})

test('the Expo SDK table wins over npm for the modules it pins', () => {
  const table = { 'expo-camera': '~17.0.8', 'react-native': '0.81.4' }
  const declared = (name: string) => ({ name, spec: '*', isDev: false })
  // Outside the SDK's range: an Expo fix, not an npm upgrade.
  expect(upgradeOf({ declared: declared('expo-camera'), installed: v('16.1.0'), latest: v('18.0.0') }, table)).toMatchObject({
    group: 'expo',
    latest: '~17.0.8',
    bump: 'major',
  })
  // Within it, a newer npm release waits for the next SDK.
  expect(upgradeOf({ declared: declared('react-native'), installed: v('0.81.4'), latest: v('0.83.0') }, table)).toBe('held')
  // A module the table does not name is an npm upgrade as usual.
  expect(upgradeOf({ declared: declared('zod'), installed: v('3.0.0'), latest: v('4.0.0') }, table)).toMatchObject({ group: 'review', conflicts: [] })
})

test('the summary counts each group', () => {
  const list = sortUpgrades([
    { name: 'b', ecosystem: 'npm', spec: '^1.0.0', current: '1.0.0', latest: '1.1.0', bump: 'minor', isDev: false, group: 'bump', conflicts: [] },
    { name: 'a', ecosystem: 'npm', spec: '^1.0.0', current: '1.0.0', latest: '2.0.0', bump: 'major', isDev: false, group: 'review', conflicts: [] },
  ])
  expect(list.map(u => u.name)).toEqual(['a', 'b'])
  expect(summaryOf(list, 10)).toBe('2 para actualizar de 10 · 1 mayores · 1 triviales')
  expect(summaryOf([], 10)).toBe('Todo al día · 10 librerías revisadas')
})

// A project with two trivial upgrades (zod, typescript), one major (react)
// and one current library (lodash).
const FILES = {
  'package.json': JSON.stringify({
    dependencies: { react: '^18.2.0', zod: '^3.22.0', lodash: '^4.17.21' },
    devDependencies: { typescript: '~5.4.0' },
  }),
  'package-lock.json': JSON.stringify({ packages: {} }),
  'node_modules/react/package.json': JSON.stringify({ version: '18.2.0' }),
  'node_modules/zod/package.json': JSON.stringify({ version: '3.22.4' }),
  'node_modules/lodash/package.json': JSON.stringify({ version: '4.17.21' }),
  'node_modules/typescript/package.json': JSON.stringify({ version: '5.4.5' }),
}
const LATEST = { react: '19.2.0', zod: '3.25.1', lodash: '4.17.21', typescript: '5.9.3' }

// The scan runs in the background so the session starts at once: wait for
// the pane to show its result.
async function scanned($: Engine) {
  for (let i = 0; i < 100; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const scanning = await ui.find({ type: 'Text', text: /Buscando/ })
    await ui.unmount()
    if (!scanning) return
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
}

test('the package manager comes from the lockfile', () => {
  expect(managerOf(['package-lock.json'])).toBe('npm')
  expect(managerOf(['pnpm-lock.yaml'])).toBe('pnpm')
  expect(managerOf(['yarn.lock'])).toBe('yarn')
  expect(managerOf(['bun.lock'])).toBe('bun')
  expect(managerOf([])).toBe('npm')
})

test('an upgrade keeps the range prefix package.json wrote', () => {
  expect(rangeFor('^3.22.0', '3.25.1')).toBe('^3.25.1')
  expect(rangeFor('~5.4.0', '5.9.3')).toBe('~5.9.3')
  expect(rangeFor('1.2.0', '1.3.0')).toBe('1.3.0')
})

test('dependencies and devDependencies install in their own sections', () => {
  const up = (name: string, isDev: boolean) =>
    ({ name, ecosystem: 'npm', spec: '^1.0.0', current: '1.0.0', latest: '1.1.0', bump: 'minor', isDev, group: 'bump', conflicts: [] as string[] }) as const
  expect(installArgv('npm', [up('a', false), up('b', true), up('c', false)])).toEqual([
    ['npm', 'install', 'a@^1.1.0', 'c@^1.1.0'],
    ['npm', 'install', '--save-dev', 'b@^1.1.0'],
  ])
  expect(installArgv('pnpm', [up('b', true)])).toEqual([['pnpm', 'add', '-D', 'b@^1.1.0']])
})

test('the button installs the trivial upgrades and scans again', async ($, on) => {
  const latest: Record<string, string> = { ...LATEST }
  const files: Record<string, string> = { ...FILES }
  project(on, files, latest)
  const ran: string[][] = []
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    // The install moves what it upgraded to the new version; git calls
    // (the scan lists manifests with git ls-files) change nothing.
    if (e.argv[0] === 'npm') {
      files['node_modules/zod/package.json'] = JSON.stringify({ version: '3.25.1' })
      files['node_modules/typescript/package.json'] = JSON.stringify({ version: '5.9.3' })
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'upgrade-bumps' })

  // The major (react) is left for the person to review.
  expect(ran.filter(argv => argv[0] === 'npm')).toEqual([
    ['npm', 'install', 'zod@^3.25.1'],
    ['npm', 'install', '--save-dev', 'typescript@~5.9.3'],
  ])
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('1 para actualizar de 4 · 1 mayores')
  expect((await ui.find({ type: 'Text', text: /^Actualicé/ }))?.text).toBe('Actualicé 2 librerías. Ejecuta los tests antes de hacer commit.')
  await ui.unmount()
})

test('a failed install says why and keeps the list', async ($, on) => {
  project(on, { ...FILES }, { ...LATEST })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'npm ERR! ERESOLVE could not resolve', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'upgrade-bumps' })

  expect((await ui.find({ type: 'Text', text: /código 1/ }))?.text).toBe('npm install terminó con código 1: npm ERR! ERESOLVE could not resolve')
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('3 para actualizar de 4 · 1 mayores · 2 triviales')
  await ui.unmount()
})

// Waits a bounded while for what background work does.
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
}

test('opening a project with upgrades opens the pane and lists them, on every surface', async ($, on) => {
  const opened: string[] = []
  project(on, { ...FILES }, { ...LATEST }, opened)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  await until(() => opened.length > 0)

  expect(opened).toEqual(['narsil-check'])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('3 para actualizar de 4 · 1 mayores · 2 triviales')
    expect((await ui.find({ type: 'Text', text: /^react/ }))?.text).toBe('react 18.2.0 → 19.2.0')
    expect((await ui.find({ type: 'Text', text: /^zod/ }))?.text).toBe('zod 3.22.4 → 3.25.1')
    expect((await ui.find({ type: 'Text', text: /^typescript/ }))?.text).toBe('typescript 5.4.5 → 5.9.3 · dev')
    // A library that is current is not listed.
    expect(await ui.find({ type: 'Text', text: /^lodash/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the pane opens even when everything is current, and /upgrades opens it again', async ($, on) => {
  const opened: string[] = []
  project(on, { ...FILES }, { react: '18.2.0', zod: '3.22.4', lodash: '4.17.21', typescript: '5.4.5' }, opened)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  expect(opened).toEqual(['narsil-check'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /al día/ }))?.text).toBe('Todo al día · 4 librerías revisadas')
  await ui.unmount()

  await $.command.run({ command: 'narsil-check', args: 'upgrade', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await scanned($)
  expect(opened).toEqual(['narsil-check', 'narsil-check'])
})

test('the pane opens on every session, a project without manifests too: it stands in for the session bar', async ($, on) => {
  const opened: string[] = []
  project(on, {}, {}, opened)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(opened).toEqual(['narsil-check'])
})

test('a scan an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: { status: 'done', rows: [] }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /Buscando/ }))?.text).toBe('Buscando actualizaciones…')
  await ui.unmount()
})


test('the pending upgrades are the ranges that changed since HEAD', () => {
  const before = [
    { name: 'react', spec: '^19.3.0', isDev: false },
    { name: 'zod', spec: '^3.22.0', isDev: false },
    { name: 'lodash', spec: '^4.17.21', isDev: false },
  ]
  const after = [
    { name: 'zod', spec: '^3.25.1', isDev: false },
    { name: 'react', spec: '^19.3.1', isDev: false },
    { name: 'lodash', spec: '^4.17.21', isDev: false },
    // Added since HEAD: not an upgrade.
    { name: 'dayjs', spec: '^1.11.0', isDev: false },
  ]
  expect(specChanges(before, after)).toEqual([
    { name: 'react', from: '^19.3.0', to: '^19.3.1' },
    { name: 'zod', from: '^3.22.0', to: '^3.25.1' },
  ])
  expect(commitTitle([{ name: 'a', from: '1', to: '2' }])).toBe('chore(deps): upgrade 1 dependency')
})

test('the branch is named by day, and by time when the day is taken', () => {
  const at = new Date(2026, 10, 4, 9, 5).getTime()
  expect(branchName(at, false)).toBe('chore/upgrade-deps-2026-11-04')
  expect(branchName(at, true)).toBe('chore/upgrade-deps-2026-11-04-0905')
})

test('the PR address is the URL gh prints', () => {
  expect(prUrlOf('Creating pull request\nhttps://github.com/o/r/pull/12\n')).toBe('https://github.com/o/r/pull/12')
  expect(prUrlOf('nothing')).toBeUndefined()
})

// The commands a press ran, up to its last push or PR: the check of what is
// left pending, which runs after, is not the press's.
function pressed(ran: string[][]): string[][] {
  let end = 0
  ran.forEach((argv, i) => {
    if (argv[0] === 'gh' || argv[1] === 'push') end = i + 1
  })
  return ran.slice(0, end)
}

test('the default branch is the one origin names, else main or master', () => {
  expect(isMainBranch('main', 'origin/main\n')).toBe(true)
  expect(isMainBranch('develop', 'origin/develop')).toBe(true)
  expect(isMainBranch('feat/login', 'origin/main')).toBe(false)
  expect(isMainBranch('master', '')).toBe(true)
  expect(isMainBranch('feat/login', '')).toBe(false)
})

test('on a work branch the button commits and pushes to it, with no new branch or PR', async ($, on) => {
  project(on, { ...FILES }, { ...LATEST })
  const ran = host(on, undefined, 'feat/login')
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /push/ }))?.text).toBe('Commit y push a feat/login')
  const before = ran.length
  await ui.press({ key: 'publish-pr' })

  expect(pressed(ran.slice(before)).map(argv => argv.slice(0, 3).join(' '))).toEqual([
    'git branch --show-current',
    'git symbolic-ref --short',
    'git add --',
    'git commit -m',
    'git push -u',
  ])
  expect(ran.find(argv => argv[1] === 'push')).toEqual(['git', 'push', '-u', 'origin', 'feat/login'])
  expect(ran.some(argv => argv[0] === 'gh' || argv[1] === 'switch')).toBe(false)
  expect((await ui.find({ type: 'Text', text: /^Commit subido/ }))?.text).toBe('Commit subido a la rama feat/login.')
  await ui.unmount()
})

// package.json as HEAD holds it, before react and zod went up.
const HEAD_MANIFEST = JSON.stringify({
  dependencies: { react: '^18.0.0', zod: '^3.20.0', lodash: '^4.17.21' },
  devDependencies: { typescript: '~5.4.0' },
})

// A git repository and gh, standing for the host: answers each command and
// records it.
function host(on: On, failAt?: string, current = 'main') {
  const ran: string[][] = []
  const done = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal: no remote' : '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const line = argv.join(' ')
    if (failAt && line.startsWith(failAt)) return done('', 1)
    // HEAD holds the ranges before the upgrade: react and zod moved since.
    if (line.startsWith('git --no-pager show HEAD:package.json')) return done(HEAD_MANIFEST)
    if (line.startsWith('git status')) return done(' M package.json\n M package-lock.json\n')
    if (line.startsWith('git branch --show-current')) return done(`${current}\n`)
    if (line.startsWith('git symbolic-ref')) return done('origin/main\n')
    if (line.startsWith('git rev-parse')) return done('', 1)
    if (line.startsWith('gh pr create')) return done('https://github.com/davshn/demo/pull/7\n')
    return done()
  })
  return ran
}

test('the PR button makes a branch, commits package.json and the lock, pushes and opens a PR', async ($, on) => {
  project(on, { ...FILES }, { ...LATEST })
  const ran = host(on)
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Sin commit/ }))?.text).toBe('Sin commit: 2 librerías actualizadas en package.json')
  expect((await ui.find({ type: 'Button', text: /PR/ }))?.text).toBe('Crear rama, commit y PR')
  const before = ran.length
  await ui.press({ key: 'publish-pr' })

  const git = pressed(ran.slice(before))
  const branch = git.find(argv => argv[1] === 'switch')?.[3] ?? ''
  expect(branch).toMatch(/^chore\/upgrade-deps-\d{4}-\d{2}-\d{2}$/)
  expect(git.map(argv => argv.slice(0, 3).join(' '))).toEqual([
    'git branch --show-current',
    'git symbolic-ref --short',
    'git rev-parse --verify',
    'git switch -c',
    'git add --',
    'git commit -m',
    'git push -u',
    'gh pr create',
  ])
  // Only package.json and its lockfile go in the commit.
  expect(git.find(argv => argv[1] === 'add')).toEqual(['git', 'add', '--', 'package.json', 'package-lock.json'])
  const commit = git.find(argv => argv[1] === 'commit') ?? []
  expect(commit.slice(-3)).toEqual(['--', 'package.json', 'package-lock.json'])
  expect(commit[3]).toBe('chore(deps): upgrade 2 dependencies')
  expect(git.find(argv => argv[0] === 'gh')?.slice(0, 7)).toEqual(['gh', 'pr', 'create', '--base', 'main', '--head', branch])
  expect((await ui.find({ type: 'Text', text: /^PR creado/ }))?.text).toBe(`PR creado desde la rama ${branch}. Sigues en esa rama.`)
  await ui.unmount()
})

test('a failed push says which step failed', async ($, on) => {
  project(on, { ...FILES }, { ...LATEST })
  host(on, 'git push')

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'publish-pr' })

  expect((await ui.find({ type: 'Text', text: /^No pude crear el PR/ }))?.text).toBe('No pude crear el PR. Subiendo la rama: fatal: no remote')
  await ui.unmount()
})

test('the versions that break between two, newest first', () => {
  expect(breakingVersions('18.2.0', '19.2.0')).toEqual(['19.0.0'])
  expect(breakingVersions('3.1.0', '7.0.0')).toEqual(['7.0.0', '6.0.0', '5.0.0'])
  // Below 1.0.0 each minor breaks.
  expect(breakingVersions('0.3.1', '0.5.2')).toEqual(['0.5.0', '0.4.0'])
  expect(releaseTags('@astrojs/react', '5.0.0')).toEqual(['v5.0.0', '@astrojs/react@5.0.0', '5.0.0'])
})

test('the GitHub repository a package records', () => {
  expect(repoOf({ repository: { url: 'git+https://github.com/react/react.git', directory: 'packages/react' } })).toEqual({ owner: 'react', repo: 'react' })
  expect(repoOf({ repository: 'github:colinhacks/zod' })).toEqual({ owner: 'colinhacks', repo: 'zod' })
  expect(repoOf({ repository: 'colinhacks/zod' })).toEqual({ owner: 'colinhacks', repo: 'zod' })
  expect(repoOf({ repository: { url: 'https://gitlab.com/a/b' } })).toBeUndefined()
  expect(repoOf({})).toBeUndefined()
})

test('a changelog is cut where the installed version begins', () => {
  const text = ['# Changelog', '## 3.0.0', '- removed foo()', '## 2.1.0', '- added bar', '## 2.0.0', '- old'].join('\n')
  expect(changelogSince(text, '2.1.0')).toBe(['# Changelog', '## 3.0.0', '- removed foo()'].join('\n'))
})

test('the import pattern escapes the name and takes subpaths', () => {
  expect(importPattern('react-icons')).toBe(String.raw`(from[[:space:]]+|require\(|import\()['"]react-icons(/[^'"]*)?['"]`)
  expect(importPattern('lodash.merge')).toContain(String.raw`lodash\.merge`)
})

test("Haiku's answer is read as a difficulty and a reason", () => {
  expect(parseReason('DIFICULTAD: alta\nRAZÓN: React 19 quita propTypes, que usas en 3 componentes.')).toEqual({
    difficulty: 'alta',
    text: 'React 19 quita propTypes, que usas en 3 componentes.',
  })
  expect(parseReason('no sé')).toBeUndefined()
})

test('the copied text lists each major with its reason', () => {
  const react = { name: 'react', ecosystem: 'npm', spec: '^18.2.0', current: '18.2.0', latest: '19.2.0', bump: 'major', isDev: false, group: 'review', conflicts: [] as string[] } as const
  const zod = { ...react, name: 'zod', current: '3.22.4', latest: '4.0.0' }
  expect(copyText([react, zod], { 'react@18.2.0->19.2.0': { difficulty: 'alta', text: 'Quita propTypes.' } })).toBe(
    ['Librerías con versión mayor pendiente:', '- react 18.2.0 → 19.2.0 (dificultad alta): Quita propTypes.', '- zod 3.22.4 → 4.0.0'].join('\n'),
  )
})

test('each major shows the reason Haiku gives from the release notes and the imports, and the copy button copies them', async ($, on) => {
  const files = { ...FILES, 'node_modules/react/package.json': JSON.stringify({ version: '18.2.0', repository: { url: 'git+https://github.com/react/react.git' } }) }
  const web = { 'https://api.github.com/repos/react/react/releases/tags/v19.0.0': JSON.stringify({ body: 'Removed propTypes checks. Removed string refs.' }) }
  project(on, files, { ...LATEST }, [], web)
  const asked: string[] = []
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: 'DIFICULTAD: media\nRAZÓN: React 19 quita propTypes; tus 2 imports no los usan, pero revisa las refs de texto.',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  on('process.run', (_, e) => ({
    value: {
      exitCode: e.argv.includes('grep') ? 0 : 1,
      stdout: e.argv.includes('grep') ? "src/App.tsx:1:import { useState } from 'react'\nsrc/main.tsx:2:import React from 'react'\n" : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  await until(() => asked.length > 0)
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (let i = 0; i < 100 && (await ui.find({ type: 'Text', text: /Analizando/ })); i++) {
    await ui.unmount()
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
    ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  }

  // Haiku is given the release notes and the project's imports.
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('Removed propTypes checks')
  expect(asked[0]).toContain("src/App.tsx:1:import { useState } from 'react'")
  expect(asked[0]).toContain('in 2 files')
  expect((await ui.find({ type: 'Text', text: /^ *Dificultad/ }))?.text).toBe('  Dificultad media: React 19 quita propTypes; tus 2 imports no los usan, pero revisa las refs de texto.')

  await ui.press({ key: 'copy-majors' })
  expect(copied).toEqual([
    'Librerías con versión mayor pendiente:\n- react 18.2.0 → 19.2.0 (dificultad media): React 19 quita propTypes; tus 2 imports no los usan, pero revisa las refs de texto.',
  ])
  await ui.unmount()
})

test('a major read before is not asked again', async ($, on) => {
  const store = project(on, { ...FILES }, { ...LATEST })
  store.set('why:react@18.2.0->19.2.0', { difficulty: 'baja', text: 'Guardada.' })
  let asked = 0
  on('model.complete', () => {
    asked++
    return { value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  let text: string | undefined
  for (let i = 0; i < 100 && !text; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    text = (await ui.find({ type: 'Text', text: /^ *Dificultad/ }))?.text
    await ui.unmount()
    if (!text) await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }

  expect(text).toBe('  Dificultad baja: Guardada.')
  expect(asked).toBe(0)
})

test('peer ranges as packages write them', () => {
  expect(satisfies(v('7.0.2'), '^5.0.0 || ^6.0.0')).toBe(false)
  expect(satisfies(v('6.0.3'), '^5.0.0 || ^6.0.0')).toBe(true)
  expect(satisfies(v('7.0.2'), '>=4.8.4 <6.1.0')).toBe(false)
  expect(satisfies(v('5.9.3'), '>=4.8.4 <6.1.0')).toBe(true)
  expect(satisfies(v('10.14.0'), '^9.35.0')).toBe(false)
  expect(satisfies(v('10.14.0'), '^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9')).toBe(false)
  expect(satisfies(v('9.39.5'), '^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9')).toBe(true)
  expect(satisfies(v('9.39.5'), '^9.7')).toBe(true)
  expect(satisfies(v('9.39.5'), '>=10.0.0')).toBe(false)
  expect(satisfies(v('10.0.0'), '*')).toBe(true)
  expect(satisfies(v('9.1.0'), '9.x')).toBe(true)
  expect(satisfies(v('10.0.0'), '9')).toBe(false)
  expect(satisfies(v('2.5.0'), '1 - 2')).toBe(true)
  expect(satisfies(v('3.0.0'), '1 - 2')).toBe(false)
  expect(satisfies(v('9.9.0'), '<=9')).toBe(true)
  expect(satisfies(v('10.0.0'), '>9')).toBe(true)
  expect(satisfies(v('9.5.0'), '>9')).toBe(false)
  expect(satisfies(v('1.2.9'), '~1.2')).toBe(true)
  expect(satisfies(v('1.3.0'), '~1.2')).toBe(false)
})

// What portfolio-v3 had installed, with the peers each package asks for.
function portfolio(): Map<string, Installed> {
  const at = (version: string, peers: Record<string, string> = {}) => installedFromManifest({ peerDependencies: peers }, v(version))
  return new Map([
    ['eslint', at('9.39.5')],
    ['typescript', at('5.9.3')],
    ['astro', at('5.18.2')],
    ['@astrojs/check', at('0.9.12', { typescript: '^5.0.0 || ^6.0.0' })],
    ['@typescript-eslint/parser', at('8.72.1', { eslint: '^8.57.0 || ^9.0.0 || ^10.0.0', typescript: '>=4.8.4 <6.1.0' })],
    ['eslint-config-love', at('151.0.0', { eslint: '^9.35.0', typescript: '*' })],
    ['eslint-plugin-import', at('2.32.0', { eslint: '^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9' })],
    ['eslint-plugin-prettier', at('5.5.7', { eslint: '>=8.0.0' })],
    ['eslint-plugin-astro', at('1.3.1', { eslint: '>=8.57.0' })],
  ])
}

test('typescript 7 is blocked by the packages that ask for an older one', () => {
  expect(peerConflicts('typescript', installedFromManifest({}, v('7.0.2')), portfolio())).toEqual([
    '@astrojs/check exige typescript ^5.0.0 || ^6.0.0',
    '@typescript-eslint/parser exige typescript >=4.8.4 <6.1.0',
  ])
})

test('eslint 10 is blocked by the configs and plugins that stop at 9', () => {
  expect(peerConflicts('eslint', installedFromManifest({ peerDependencies: { jiti: '*' } }, v('10.14.0')), portfolio())).toEqual([
    'eslint-config-love exige eslint ^9.35.0',
    'eslint-plugin-import exige eslint ^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9',
  ])
})

test('eslint-plugin-astro 3 is blocked by the eslint it needs', () => {
  const target = installedFromManifest({ peerDependencies: { eslint: '>=10.0.0', 'typescript-eslint': '>=8.61.0' } }, v('3.2.1'))
  expect(peerConflicts('eslint-plugin-astro', target, portfolio())).toEqual(['eslint-plugin-astro 3.2.1 necesita eslint >=10.0.0 (tienes 9.39.5)'])
})

test('an upgrade every peer accepts has no conflicts', () => {
  expect(peerConflicts('prettier', installedFromManifest({}, v('3.9.10')), portfolio())).toEqual([])
})

test('a blocked upgrade shows what blocks it and the button leaves it out', async ($, on) => {
  const files = {
    ...FILES,
    'node_modules/zod/package.json': JSON.stringify({ version: '3.22.4' }),
    // A plugin installed for typescript 5 only: typescript 5.9.3 cannot go up.
    'package.json': JSON.stringify({
      dependencies: { react: '^18.2.0', zod: '^3.22.0', lodash: '^4.17.21' },
      devDependencies: { typescript: '~5.4.0', 'ts-plugin': '^1.0.0' },
    }),
    'node_modules/ts-plugin/package.json': JSON.stringify({ version: '1.0.0', peerDependencies: { typescript: '~5.4.0' } }),
  }
  project(on, files, { ...LATEST, 'ts-plugin': '1.0.0' }, [], {
    'https://registry.npmjs.org/typescript/5.9.3': JSON.stringify({ version: '5.9.3' }),
  })
  const ran = host(on)
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Bloqueada/ }))?.text).toBe('Bloqueada (1)')
  expect((await ui.find({ type: 'Text', text: /exige typescript/ }))?.text).toBe('  ts-plugin exige typescript ~5.4.0')
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('3 para actualizar de 5 · 1 bloqueadas · 1 mayores · 1 triviales')

  await ui.press({ key: 'upgrade-bumps' })
  expect(ran.filter(argv => argv[0] === 'npm')).toEqual([['npm', 'install', 'zod@^3.25.1']])
  await ui.unmount()
})

test('the blocked and the major groups each copy their own list', async ($, on) => {
  const files = {
    ...FILES,
    'package.json': JSON.stringify({
      dependencies: { react: '^18.2.0', zod: '^3.22.0', lodash: '^4.17.21' },
      devDependencies: { typescript: '~5.4.0', 'ts-plugin': '^1.0.0' },
    }),
    'node_modules/ts-plugin/package.json': JSON.stringify({ version: '1.0.0', peerDependencies: { typescript: '~5.4.0' } }),
  }
  project(on, files, { ...LATEST, 'ts-plugin': '1.0.0' }, [], {
    'https://registry.npmjs.org/typescript/5.9.3': JSON.stringify({ version: '5.9.3' }),
  })
  host(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'copy-blocked' })
  await ui.press({ key: 'copy-majors' })

  expect(copied).toEqual([
    'Librerías bloqueadas:\n- typescript 5.4.5 → 5.9.3: ts-plugin exige typescript ~5.4.0',
    'Librerías con versión mayor pendiente:\n- react 18.2.0 → 19.2.0',
  ])
  await ui.unmount()
})

// portfolio-v3's package-lock.json before afe1c65, down to what matters:
// typescript-eslint pins its siblings, and the tailwind family pins each
// other, both in lockstep.
const PINNED_LOCK = {
  packages: {
    '': { dependencies: {} },
    'node_modules/typescript-eslint': {
      version: '8.71.0',
      dependencies: { '@typescript-eslint/eslint-plugin': '8.71.0', '@typescript-eslint/parser': '8.71.0' },
    },
    'node_modules/eslint-config-love': { version: '151.0.0', dependencies: { 'typescript-eslint': '^8.53.0' } },
    'node_modules/@typescript-eslint/parser': { version: '8.71.0' },
    'node_modules/@typescript-eslint/eslint-plugin': { version: '8.71.0' },
    'node_modules/@tailwindcss/vite': { version: '4.3.3', dependencies: { tailwindcss: '4.3.3', '@tailwindcss/node': '4.3.3' } },
    'node_modules/@tailwindcss/node': { version: '4.3.3', dependencies: { tailwindcss: '4.3.3' } },
    'node_modules/tailwindcss': { version: '4.3.3' },
    'node_modules/some-lib': { version: '1.0.0', dependencies: { prettier: '^3.0.0' } },
  },
}

test('only a range naming one version is an exact pin', () => {
  expect(isExactPin('8.71.0')).toBe(true)
  expect(isExactPin('=8.71.0')).toBe(true)
  expect(isExactPin('1.0.0-beta.2')).toBe(true)
  expect(isExactPin('^8.71.0')).toBe(false)
  expect(isExactPin('~8.71.0')).toBe(false)
  expect(isExactPin('8.x')).toBe(false)
})

test('a package in the tree that pins the old version leaves two copies', () => {
  expect(pinConflicts('@typescript-eslint/parser', v('8.72.1'), PINNED_LOCK)).toEqual([
    'typescript-eslint 8.71.0 fija @typescript-eslint/parser 8.71.0: quedarían dos copias',
  ])
  // A range the new version leaves is not a pin: a nested copy there is harmless.
  expect(pinConflicts('prettier', v('4.0.0'), PINNED_LOCK)).toEqual([])
  expect(pinConflicts('anything', v('1.0.0'), {})).toEqual([])
})

test('a family that goes up together carries its pins, through its own members too', () => {
  const batch = new Map([
    ['@tailwindcss/vite', '4.3.4'],
    ['tailwindcss', '4.3.4'],
    ['@typescript-eslint/parser', '8.72.1'],
    ['@typescript-eslint/eslint-plugin', '8.72.1'],
  ])
  // @tailwindcss/vite goes up with it, and pins @tailwindcss/node in lockstep.
  expect(pinConflicts('tailwindcss', v('4.3.4'), PINNED_LOCK, batch)).toEqual([])
  // Without @tailwindcss/vite in the batch, both pins stay.
  expect(pinConflicts('tailwindcss', v('4.3.4'), PINNED_LOCK, new Map([['tailwindcss', '4.3.4']]))).toEqual([
    '@tailwindcss/vite 4.3.3 fija tailwindcss 4.3.3: quedarían dos copias',
    '@tailwindcss/node 4.3.3 fija tailwindcss 4.3.3: quedarían dos copias',
  ])
  // typescript-eslint is not declared, so nothing in the batch carries it.
  expect(pinConflicts('@typescript-eslint/parser', v('8.72.1'), PINNED_LOCK, batch)).toEqual([
    'typescript-eslint 8.71.0 fija @typescript-eslint/parser 8.71.0: quedarían dos copias',
  ])
})

test('the button leaves out an upgrade a package in the tree pins', async ($, on) => {
  const files = {
    ...FILES,
    'package-lock.json': JSON.stringify({
      packages: {
        '': {},
        'node_modules/zod-family': { version: '3.22.4', dependencies: { zod: '3.22.4' } },
      },
    }),
  }
  project(on, files, { ...LATEST })
  const ran = host(on)
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /quedarían dos copias/ }))?.text).toBe('  zod-family 3.22.4 fija zod 3.22.4: quedarían dos copias')

  await ui.press({ key: 'upgrade-bumps' })
  expect(ran.filter(argv => argv[0] === 'npm')).toEqual([['npm', 'install', '--save-dev', 'typescript@~5.9.3']])
  await ui.unmount()
})

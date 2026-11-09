import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { WRAPPER } from '../hooks/kmp'
import { GRADLE_WRAPPER } from '../hooks/wrapper'
import { OLD, released } from './released'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const PROPERTIES = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.6.0-bin.zip
validateDistributionUrl=true
`
const CURRENT = 'https://services.gradle.org/versions/current'
// As services.gradle.org writes a build's time.
const stamp = (iso: string) => `${iso.replace(/[-:]/g, '').replace('T', '').slice(0, 14)}+0000`
const answer = (version: string, iso = OLD) => JSON.stringify({ version, buildTime: stamp(iso), current: true })

test('the wrapper gives the Gradle version it downloads', () => {
  expect(GRADLE_WRAPPER.parse({ [WRAPPER]: PROPERTIES })).toEqual([{ name: 'gradle-wrapper', spec: '9.6.0', isDev: false, installed: '9.6.0', source: `file:${WRAPPER}` }])
  expect(GRADLE_WRAPPER.parse({ [WRAPPER]: 'distributionBase=GRADLE_USER_HOME\n' })).toEqual([])
})

test('the version service answers the latest release and when it was built', () => {
  expect(GRADLE_WRAPPER.latestOf(answer('9.9.0'))).toBe('9.9.0')
  expect(GRADLE_WRAPPER.latestOf('{}')).toBeUndefined()
  expect(GRADLE_WRAPPER.releasedOf?.(JSON.stringify({ buildTime: '20261106154935+0000' }), {})).toBe('2026-11-06T15:49:35+00:00')
  expect(GRADLE_WRAPPER.releasedOf?.('{}', {})).toBeUndefined()
})

function project(on: On, latest: string, extra: Record<string, string> = {}) {
  const files: Record<string, string> = { [WRAPPER]: PROPERTIES, ...extra }
  const store = new Map<string, unknown>()
  const keyOf = (path: string) => {
    const at = path.replace(/\\/g, '/')
    return Object.keys(files).find(name => at === name || at.endsWith(`/${name}`))
  }
  on('fs.exists', (_, e) => ({ value: keyOf(e.path) !== undefined }))
  on('fs.read', (_, e) => {
    const key = keyOf(e.path)
    if (key === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: files[key] as string }
  })
  on('fs.write', (_, e) => {
    files[keyOf(e.path) ?? e.path] = e.text
    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'upgrades' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const osv: string[] = []
  on('http.fetch', (_, e) => {
    if (e.url === CURRENT) return { value: { status: 200, ok: true, headers: {}, text: latest } }
    if (e.url.includes('osv.dev')) osv.push(String(e.init?.body ?? ''))
    return released(e.url) ?? { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  on('process.run', (_, e) => {
    const ls = e.argv[1] === 'ls-files'
    return { value: { exitCode: ls ? 0 : e.argv[0] === 'git' ? 1 : 0, stdout: ls ? ['build.gradle.kts', ...Object.keys(extra)].filter(p => p in files).join('\n') : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { files, osv }
}

async function scanned($: Engine) {
  for (let i = 0; i < 100; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const scanning = await ui.find({ type: 'Text', text: /Buscando/ })
    await ui.unmount()
    if (!scanning) return
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
}

test('a newer Gradle is listed and the button raises the distribution, every other byte as it was', async ($, on) => {
  const { files } = project(on, answer('9.9.0'))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('1 para actualizar de 1 · 1 triviales')
  expect((await ui.find({ type: 'Button', text: /^gradle-wrapper/ }))?.text).toBe('gradle-wrapper 9.6.0 → 9.9.0')

  await ui.press({ key: 'upgrade-bumps' })
  expect(files[WRAPPER]).toBe(PROPERTIES.replace('gradle-9.6.0-bin.zip', 'gradle-9.9.0-bin.zip'))
  await ui.unmount()
})

test('a Gradle built less than a day ago waits like any other release', async ($, on) => {
  project(on, answer('9.9.0', new Date(Date.now() - 60 * 60 * 1000).toISOString()))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('1 para actualizar de 1 · 1 bloqueadas')
  await ui.unmount()
})

test('a wrapper that checks a checksum is blocked with the reason, since the sum changes too', () => {
  const u = { name: 'gradle-wrapper', ecosystem: 'gradle-wrapper', spec: '9.6.0', current: '9.6.0', latest: '9.9.0', bump: 'minor', isDev: false, group: 'bump', conflicts: [] as string[] } as const
  expect(GRADLE_WRAPPER.conflictsOf?.(u, [], { [WRAPPER]: PROPERTIES })).toEqual([])
  expect(GRADLE_WRAPPER.conflictsOf?.(u, [], { [WRAPPER]: `${PROPERTIES}distributionSha256Sum=abc\n` })).toEqual(['El wrapper verifica distributionSha256Sum: súbelo con ./gradlew wrapper --gradle-version 9.9.0 --gradle-distribution-sha256-sum <suma>'])
})

test('the vulnerabilities check never asks OSV about the wrapper, which it does not know', async ($, on) => {
  const { osv } = project(on, answer('9.6.0'), { 'build.gradle.kts': 'dependencies {\n    implementation("io.mockk:mockk:1.13.10")\n}\n' })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  for (let i = 0; i < 100 && osv.length === 0; i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 10))

  expect(osv.length).toBeGreaterThan(0)
  expect(osv.join('')).toContain('io.mockk:mockk')
  expect(osv.join('')).not.toContain('gradle-wrapper')
})

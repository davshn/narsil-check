import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { GROUPS, PALETTE, commandHelp, sectionColor, sectionLabel } from '../hooks/words'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const up = (group: 'bump' | 'review' | 'blocked' | 'expo') =>
  ({ name: 'x', ecosystem: 'npm', spec: '^1.0.0', current: '1.0.0', latest: '1.1.0', bump: 'minor', isDev: false, group, conflicts: [] as string[] }) as const

test("the pane speaks in Narsil's colors", () => {
  expect(PALETTE).toEqual({ info: '#3B8BFF', muted: '#8A90A6', waiting: '#F5B400', done: '#22B573', error: '#F0435A' })
  expect(GROUPS.map(g => [g.group, g.color])).toEqual([
    ['expo', '#3B8BFF'],
    ['blocked', '#F0435A'],
    ['review', '#F5B400'],
    ['bump', '#22B573'],
  ])
})

test('the section is colored by what most needs you, and its toggle names it', () => {
  const done = (groups: ('bump' | 'review' | 'blocked' | 'expo')[]) =>
    ({ status: 'done' as const, upgrades: groups.map(up), held: 0, checked: 5, failed: 0, at: 0, ecosystems: ['npm' as const] })
  expect(sectionColor(done(['bump', 'review', 'blocked']))).toBe('#F0435A')
  expect(sectionColor(done(['bump', 'review']))).toBe('#F5B400')
  expect(sectionColor(done(['bump']))).toBe('#22B573')
  expect(sectionColor(done([]))).toBe('#22B573')
  expect(sectionColor({ status: 'scanning' })).toBe('#8A90A6')
  expect(sectionLabel(true, done(['bump', 'review']))).toBe('▾ Actualizaciones · 2')
  expect(sectionLabel(false, done([]))).toBe('▸ Actualizaciones')
})

test('/narsil-check answers with its checks to anything but one it knows', () => {
  expect(commandHelp('')).toBe('Narsil Check: revisiones del proyecto. /narsil-check upgrade: las librerías que se pueden actualizar. /narsil-check vulns: las vulnerabilidades conocidas.')
  expect(commandHelp('todo')).toBe('Narsil Check: no conozco "todo". Revisiones: /narsil-check upgrade: las librerías que se pueden actualizar. /narsil-check vulns: las vulnerabilidades conocidas.')
})

// A project with one trivial upgrade, standing for the engine.
function project(on: On) {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ dependencies: { zod: '^3.22.0' } }),
    'node_modules/zod/package.json': JSON.stringify({ version: '3.22.4' }),
  }
  const store = new Map<string, unknown>()
  const opened: string[] = []
  const keyOf = (path: string) => {
    const at = path.replace(/\\/g, '/')
    return Object.keys(files)
      .sort((a, b) => b.length - a.length)
      .find(name => at === name || at.endsWith(`/${name}`))
  }
  on('fs.exists', (_, e) => ({ value: keyOf(e.path) !== undefined }))
  on('fs.read', (_, e) => {
    const key = keyOf(e.path)
    if (key === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: files[key] as string }
  })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ version: '3.25.1' }) } }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return { store, opened }
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

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

test("the pane heads with Narsil Check, and the upgrade section folds, staying folded across sessions", async ($, on) => {
  const { store } = project(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Narsil Check/ }))?.text).toBe('● Narsil Check')
    expect((await ui.find({ type: 'Button', text: /Actualizaciones/ }))?.text).toBe('▾ Actualizaciones · 1')
    expect((await ui.find({ type: 'Text', text: /^zod/ }))?.text).toBe('zod 3.22.4 → 3.25.1')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'section-upgrade' })
  expect((await ui.find({ type: 'Button', text: /Actualizaciones/ }))?.text).toBe('▸ Actualizaciones · 1')
  // Folded: the head stays, the section's body is gone.
  expect(await ui.find({ type: 'Text', text: /^zod/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Narsil Check/ }))?.text).toBe('● Narsil Check')
  expect(store.get('section:upgrade:open')).toBe(false)
  await ui.unmount()
})

test('/narsil-check upgrade opens the pane, unfolded; anything else answers with the checks', async ($, on) => {
  const { store, opened } = project(on)
  store.set('section:upgrade:open', false)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const help = await $.command.run({ command: 'narsil-check', args: '', ...TYPED })
  expect(help).toMatchObject({ text: 'Narsil Check: revisiones del proyecto. /narsil-check upgrade: las librerías que se pueden actualizar. /narsil-check vulns: las vulnerabilidades conocidas.' })

  const ran = await $.command.run({ command: 'narsil-check', args: ' Upgrade ', ...TYPED })
  expect(ran).toMatchObject({ text: 'Narsil Check: revisando las librerías del proyecto.' })
  expect(opened.at(-1)).toBe('narsil-check')
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /Actualizaciones/ }))?.text).toBe('▾ Actualizaciones · 1')
  await ui.unmount()
})

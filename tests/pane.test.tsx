import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { GROUPS, HEALTH_SIZE, PALETTE, commandHelp, healthOf, healthSvg, sectionColor, sectionLabel } from '../hooks/words'
import { ANIMADA_PARADA_CLARO, ANIMADA_PARADA_OSCURO } from '../hooks/narsil-anim'
import { OLD } from './released'

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
  expect(commandHelp('')).toBe('Narsil Check: revisiones del proyecto. /narsil-check upgrade: las librerías que se pueden actualizar. /narsil-check vulns: las vulnerabilidades conocidas. /narsil-check template "…": una tarea en Pendientes de una plantilla.')
  expect(commandHelp('todo')).toBe('Narsil Check: no conozco "todo". Revisiones: /narsil-check upgrade: las librerías que se pueden actualizar. /narsil-check vulns: las vulnerabilidades conocidas. /narsil-check template "…": una tarea en Pendientes de una plantilla.')
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
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ version: '3.25.1', time: { '3.25.1': OLD } }) } }))
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

test('the work map is the first section, open, with baby Narsil at its core; the terminal draws neither', async ($, on) => {
  project(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The title stays centered and alone; baby Narsil no longer stands under it.
  expect((await ui.find({ type: 'Box', key: 'head' }))?.props.justifyContent).toBe('center')
  expect(await ui.find({ type: 'Box', key: 'narsil' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /revisiones del proyecto/ })).toBeUndefined()
  // Mapa comes before every other section.
  const sections = (await ui.findAll({ type: 'Button' })).map(b => b.props.key).filter(k => typeof k === 'string' && k.startsWith('section-'))
  expect(sections[0]).toBe('section-map')
  expect((await ui.find({ type: 'Button', key: 'section-map' }))?.text).toBe('▾ Mapa mental')
  const map = (await ui.findAll({ type: 'Svg' }))[0]
  expect(map?.props.alt).toBe('Mapa mental. No hay nada en ejecución.')
  const source = String(map?.props.source)
  // Nothing runs yet: she sleeps.
  expect(source).toContain(ANIMADA_PARADA_CLARO.src)
  expect(source).toContain(ANIMADA_PARADA_OSCURO.src)
  // The dark Narsil shows only under a dark color scheme, and the map is animated.
  expect(source).toContain('@media (prefers-color-scheme: dark){.claro{display:none}.oscuro{display:inline}}')
  expect(source).toContain('<animate')
  expect(source.length).toBeLessThanOrEqual(131072)

  // Folded, the section keeps its head and draws no map.
  await ui.press({ key: 'section-map' })
  expect((await ui.find({ type: 'Button', key: 'section-map' }))?.text).toBe('▸ Mapa mental')
  expect((await ui.findAll({ type: 'Svg' })).map(s => s.props.alt)).toEqual(['Salud del proyecto'])
  await ui.unmount()

  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'section-map' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Narsil Check/ }))?.text).toBe('● Narsil Check')
  await ui.unmount()
})

test('a tool call lights its station on the map, named in the map\'s words for a reader', async ($, on) => {
  project(on)
  let clock = 1_000_000
  on('clock.now', () => ({ value: clock++ }))
  // A Read answers only when released: until then it is a call still running.
  let release = () => {}
  on('tool.call', (_, e) => (e.tool === 'Read' ? new Promise(resolve => (release = () => resolve({ result: {} }))) : { result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)

  // The reader hears what runs, by its station and its name only.
  const reading = $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Svg' }))[0]?.props.alt).toBe('Mapa mental. Archivos: b/content.py')
  expect(String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('>Archivos</text>')
  await ui.unmount()

  release()
  await reading
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Svg' }))[0]?.props.alt).toBe('Mapa mental. No hay nada en ejecución.')
  await ui.unmount()
})

test("the pane heads with Narsil Check, and the upgrade section opens when it finds upgrades and folds on a press", async ($, on) => {
  const { store } = project(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Narsil Check/ }))?.text).toBe('● Narsil Check')
    expect((await ui.find({ type: 'Button', text: /Actualizaciones/ }))?.text).toBe('▾ Actualizaciones · 1')
    expect((await ui.find({ type: 'Button', text: /^zod/ }))?.text).toBe('zod 3.22.4 → 3.25.1')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'section-upgrade' })
  expect((await ui.find({ type: 'Button', text: /Actualizaciones/ }))?.text).toBe('▸ Actualizaciones · 1')
  // Folded: the head stays, the section's body is gone.
  expect(await ui.find({ type: 'Button', text: /^zod/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Narsil Check/ }))?.text).toBe('● Narsil Check')
  await ui.unmount()
})

test('/narsil-check upgrade opens the pane, unfolded; anything else answers with the checks', async ($, on) => {
  const { store, opened } = project(on)
  store.set('section:upgrade:open', false)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const help = await $.command.run({ command: 'narsil-check', args: '', ...TYPED })
  expect(help).toMatchObject({ text: 'Narsil Check: revisiones del proyecto. /narsil-check upgrade: las librerías que se pueden actualizar. /narsil-check vulns: las vulnerabilidades conocidas. /narsil-check template "…": una tarea en Pendientes de una plantilla.' })

  const ran = await $.command.run({ command: 'narsil-check', args: ' Upgrade ', ...TYPED })
  expect(ran).toMatchObject({ text: 'Narsil Check: revisando las librerías del proyecto.' })
  expect(opened.at(-1)).toBe('narsil-check')
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /Actualizaciones/ }))?.text).toBe('▾ Actualizaciones · 1')
  await ui.unmount()
})

test("the project's health counts each state that has any, most urgent first", () => {
  const scan = { status: 'done' as const, upgrades: [up('bump'), up('bump'), up('review'), up('blocked')], held: 0, checked: 9, failed: 0, at: 0, ecosystems: ['npm' as const] }
  const vuln = { id: 'GHSA-1', summary: 's', severity: 'high' as const, aliases: [] }
  const audit = { status: 'done' as const, findings: [{ name: 'qs', ecosystem: 'npm' as const, version: '1.0.0', isDirect: false, vulns: [vuln, { ...vuln, id: 'GHSA-2' }] }], checked: 9, at: 0 }
  expect(healthOf(scan, audit as never, 1)).toEqual([
    { label: 'vulnerabilidades', count: 2, color: PALETTE.error },
    { label: 'bloqueada', count: 1, color: PALETTE.error },
    { label: 'mayor', count: 1, color: PALETTE.waiting },
    { label: 'triviales', count: 2, color: PALETTE.done },
    { label: 'pendiente', count: 1, color: PALETTE.muted },
  ])
  // Nothing read yet counts nothing.
  expect(healthOf({ status: 'scanning' }, { status: 'scanning' } as never, 0)).toEqual([])
})

test('the health bar gives each state a share of one rounded bar, and an empty health is all green', () => {
  const bar = healthSvg([
    { label: 'bloqueada', count: 1, color: PALETTE.error },
    { label: 'triviales', count: 3, color: PALETTE.done },
  ])
  expect(bar).toContain(`width="${HEALTH_SIZE.width}" height="${HEALTH_SIZE.height}"`)
  expect(bar).toContain(`rx="${HEALTH_SIZE.height / 2}"`)
  // 240 wide, a 2 gap: 238 split 1:3, the last segment flush with the end.
  expect(bar).toContain(`<rect x="0" y="0" width="60" height="8" fill="${PALETTE.error}"/>`)
  expect(bar).toContain(`<rect x="62" y="0" width="178" height="8" fill="${PALETTE.done}"/>`)
  expect(healthSvg([])).toContain(`<rect x="0" y="0" width="240" height="8" fill="${PALETTE.done}"/>`)
})

test('each section is a panel bordered in the color of its state; the desktop tints group heads and counts, the terminal keeps borders alone', async ($, on) => {
  project(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // One trivial upgrade: the upgrade panel is green.
  expect((await ui.find({ type: 'Box', key: 'panel-upgrade' }))?.props).toMatchObject({ borderStyle: 'round', borderColor: PALETTE.done })
  expect((await ui.find({ type: 'Box', key: 'panel-todos' }))?.props.borderColor).toBe(PALETTE.muted)
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.map(s => s.props.alt)).toEqual(['Mapa mental. No hay nada en ejecución.', 'Salud del proyecto'])
  // Nothing has run: the map's panel is green, as a section with nothing waiting.
  expect((await ui.find({ type: 'Box', key: 'panel-map' }))?.props.borderColor).toBe(PALETTE.done)
  expect((await ui.find({ type: 'Box', key: 'chip-trivial' }))?.props.backgroundColor).toBe(`${PALETTE.done}1F`)
  expect((await ui.find({ type: 'Box', key: 'row-upgrade-npm:zod' }))?.props.paddingX).toBe(1)
  await ui.unmount()

  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Box', key: 'panel-upgrade' }))?.props.borderColor).toBe(PALETTE.done)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Box', key: 'chip-trivial' }))?.props.backgroundColor).toBeUndefined()
  expect((await ui.find({ type: 'Box', key: 'row-upgrade-npm:zod' }))?.props.paddingX).toBe(0)
  await ui.unmount()
})

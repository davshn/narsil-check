import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { connectorLine, connectorsLabel, envLabel, parseConnectors, parseRemote, parseSession, pathOf, repositoryLabel, switchGlyph, webUrlOf } from '../hooks/session'
import { NO_SESSION } from '../hooks/session'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })

const CONNECTORS = {
  servers: [
    { name: 'engram', kind: 'user', status: 'connected', tool_count: 19 },
    { name: 'Claude Docs', kind: 'connector', status: 'connected', tool_count: 8 },
    { name: 'Gmail', kind: 'connector', status: 'needs_auth' },
  ],
}

// A project with no manifests, and the desktop app's servers standing in.
// `failures`: how many calls to the app's servers fail before they answer.
// `git`: what git answers, which a test may change between reads.
function app(on: On, remote: { state: string }, failures = 0, git: Record<string, string> = {}) {
  let failed = 0
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  on('fs.exists', () => ({ value: false }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'E:\\Proyectos\\app' }))
  const GIT = Object.assign(git, { 'git branch --show-current': 'feat/login\n', 'git remote get-url origin': 'git@github.com:davshn/narsil-check.git\n' })
  on('process.run', (_, e) => {
    const out = GIT[e.argv.join(' ')]
    return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('mcp.call', (_, e) => {
    calls.push(e)
    if (failed < failures) {
      failed++
      throw new Error('server not connected')
    }
    if (e.server === 'ccd_connectors') return text(CONNECTORS)
    if (e.tool === 'request_directory') return text({ path: 'E:\\Proyectos\\otro' })
    if (e.tool === 'change_directory') return text('Moved')
    if (e.tool === 'open_terminal_tab') return text({ tab_id: '3' })
    if (e.tool === 'get_session') return text({ isRemote: false, remoteControlActive: remote.state === 'on', remoteControlState: remote.state })
    remote.state = e.args.enabled ? 'on' : 'off'
    return text({ state: remote.state })
  })
  return { calls }
}

async function settled($: Engine, pattern: RegExp) {
  for (let i = 0; i < 100; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const found = await ui.find({ type: 'Button', text: pattern })
    await ui.unmount()
    if (found) return
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
}

// Waits for the Remote Control switch to show a knob.
async function knob($: Engine, glyph: string) {
  for (let i = 0; i < 100; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const found = await ui.find({ type: 'Text', text: glyph })
    await ui.unmount()
    if (found) return
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
}

test('the session section reads the app servers and names what it found', () => {
  expect(parseConnectors(CONNECTORS)).toEqual([
    { name: 'engram', status: 'connected', tools: 19 },
    { name: 'Claude Docs', status: 'connected', tools: 8 },
    { name: 'Gmail', status: 'needs_auth' },
  ])
  expect(parseConnectors({})).toBeUndefined()
  expect(parseSession({ isRemote: false, remoteControlState: 'off' })).toEqual({ remote: 'off' })
  expect(parseSession({ isRemote: true, remoteControlActive: true })).toEqual({ remote: 'on' })
  expect(parseRemote([{ type: 'text', text: '{"state":"connecting"}' }])).toBe('connecting')
  expect(parseRemote([{ type: 'text', text: 'Remote Control is now on.' }])).toBe('on')
  expect(parseRemote([{ type: 'text', text: 'nothing' }])).toBeUndefined()

  const view = { ...NO_SESSION, isLoaded: true, branch: 'main', connectors: parseConnectors(CONNECTORS) ?? [] }
  expect(envLabel(false)).toBe('▸ Entorno')
  expect(envLabel(true)).toBe('▾ Entorno')
  expect(pathOf([{ type: 'text', text: '{"path":"E:\\\\Proyectos\\\\otro"}' }])).toBe('E:\\Proyectos\\otro')
  expect(pathOf([{ type: 'text', text: 'Access granted to C:\\Users\\davsh\\code.' }])).toBe('C:\\Users\\davsh\\code')
  expect(pathOf([{ type: 'text', text: 'Granted /home/me/app' }])).toBe('/home/me/app')
  expect(pathOf([{ type: 'text', text: 'The user cancelled the picker' }])).toBeUndefined()
  expect(connectorsLabel(true, view)).toBe('▾ Conectores · 2')

  expect(webUrlOf('git@github.com:davshn/narsil-check.git')).toBe('https://github.com/davshn/narsil-check')
  expect(webUrlOf('https://github.com/davshn/narsil-check.git\n')).toBe('https://github.com/davshn/narsil-check')
  expect(webUrlOf('https://user@gitlab.com/group/sub/repo')).toBe('https://gitlab.com/group/sub/repo')
  expect(webUrlOf('ssh://git@bitbucket.org:22/team/repo.git')).toBe('https://bitbucket.org/team/repo')
  expect(webUrlOf('E:\\repos\\local')).toBeUndefined()
  expect(connectorLine({ name: 'engram', status: 'connected', tools: 1 })).toBe('engram · 1 herramienta')
  expect(connectorLine({ name: 'Gmail', status: 'needs_auth' })).toBe('Gmail · needs_auth')
  expect(webUrlOf('/srv/git/repo.git')).toBeUndefined()
  expect(repositoryLabel('https://github.com/davshn/narsil-check')).toBe('github.com/davshn/narsil-check')

  expect(switchGlyph({ ...view, remote: 'off' })).toEqual({ knob: '●━━', color: '#8A90A6', word: 'desactivado' })
  expect(switchGlyph({ ...view, remote: 'on' })).toEqual({ knob: '━━●', color: '#22B573', word: 'activado' })
  expect(switchGlyph({ ...view, remote: 'on', isSwitching: true })).toEqual({ knob: '━●━', color: '#F5B400', word: 'cambiando…' })
})

test('the pane opens with the session first: Entorno unfolded, then Conectores folded, above upgrades', async ($, on) => {
  app(on, { state: 'off' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => b.text)
  expect(buttons.slice(0, 6)).toEqual(['▾ Entorno', 'E:\\Proyectos\\app', 'feat/login', 'desactivado', '▸ Conectores · 2', '▸ Actualizaciones'])

  // No environment line: the repository, folder, branch and Remote Control.
  expect(await ui.find({ type: 'Text', text: /Local/ })).toBeUndefined()
  const repo = await ui.find({ type: 'Link' })
  expect([repo?.text, repo?.props.href]).toEqual(['github.com/davshn/narsil-check', 'https://github.com/davshn/narsil-check'])
  expect(await ui.find({ type: 'Button', key: 'remote-switch' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'env-folder' }))?.text).toBe('E:\\Proyectos\\app')
  expect((await ui.find({ type: 'Button', key: 'env-branch' }))?.text).toBe('feat/login')

  await ui.press({ key: 'section-connectors' })
  expect((await ui.find({ type: 'Text', text: /engram/ }))?.text).toBe('● engram · 19 herramientas')
  expect((await ui.find({ type: 'Text', text: /Gmail/ }))?.text).toBe('● Gmail · needs_auth')
  // A connector's row is only shown: nothing to press.
  expect(await ui.find({ type: 'Button', text: /engram|Gmail/ })).toBeUndefined()
  await ui.unmount()
})

test('the Remote Control switch turns it on through the app, then off again', async ($, on) => {
  const { calls } = app(on, { state: 'off' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)

  // The switch lives in the Entorno fold, open from the start.
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: '●━━' }))?.props.color).toBe('#8A90A6')
  await ui.press({ key: 'remote-switch' })
  await ui.unmount()
  await knob($, '━━●')
  expect(calls.filter(c => c.tool === 'set_remote_control').map(c => c.args)).toEqual([{ session_id: 'self', enabled: true }])

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: '━━●' }))?.props.color).toBe('#22B573')
  expect((await ui.find({ type: 'Button', key: 'remote-switch' }))?.text).toBe('activado')
  await ui.press({ key: 'remote-switch' })
  await ui.unmount()
  await knob($, '●━━')
  expect(calls.filter(c => c.tool === 'set_remote_control').map(c => c.args.enabled)).toEqual([true, false])
})

test('the folder picks a new working folder and moves there; the branch opens a terminal in the folder', async ($, on) => {
  const { calls } = app(on, { state: 'off' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'env-branch' })
  expect(calls.filter(c => c.server === 'terminal')).toEqual([{ server: 'terminal', tool: 'open_terminal_tab', args: { title: 'feat/login', cwd: 'E:\\Proyectos\\app' } }])

  await ui.press({ key: 'env-folder' })
  await ui.unmount()
  expect(calls.filter(c => c.server === 'ccd_directory').map(c => [c.tool, c.args])).toEqual([
    ['request_directory', {}],
    ['change_directory', { path: 'E:\\Proyectos\\otro' }],
  ])
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'env-folder' }))?.text).toBe('E:\\Proyectos\\otro')
  await ui.unmount()
})

test('servers that connect after the session starts are read once they answer, with no click', async ($, on) => {
  const clock = mock.clock(on)
  // Two reads fail (two calls each) before the app's servers answer.
  app(on, { state: 'off' }, 4)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  // While it retries the section reads, it shows no error.
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Leyendo/ }))?.text).toBe('Leyendo la sesión…')
  expect((await ui.find({ type: 'Button', key: 'section-connectors' }))?.text).toBe('▸ Conectores')
  await ui.unmount()

  await clock.advance(2_000)
  await clock.advance(8_000)
  await settled($, /Conectores · 2/)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'env-branch' }))?.text).toBe('feat/login')
  expect((await ui.find({ type: 'Text', text: /No pude/ }))).toBeUndefined()
  await ui.unmount()
})

test('the session is read again as each main turn ends: a branch switched in the turn shows', async ($, on) => {
  const git: Record<string, string> = {}
  app(on, { state: 'off' }, 0, git)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)

  git['git branch --show-current'] = 'main\n'
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  await settled($, /^main$/)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'env-branch' }))?.text).toBe('main')
  await ui.unmount()
})

test('a server the mod cannot reach says why once the retries run out', async ($, on) => {
  const clock = mock.clock(on)
  const { calls } = app(on, { state: 'off' }, Number.POSITIVE_INFINITY)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const wait of [2_000, 8_000, 20_000]) {
    await clock.settle()
    await clock.advance(wait)
  }
  await clock.settle()
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 5))
  // Four reads in all: fewer than the five failures in a row other mods take for a loop.
  expect(calls.filter(c => c.tool === 'get_session').length).toBe(4)
  expect(calls.filter(c => c.server === 'ccd_connectors').length).toBe(4)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /control remoto:/ }))?.text).toMatch(/^No pude leer o cambiar el control remoto: .+/)
  await ui.press({ key: 'section-connectors' })
  // A failed call reaches the plugin as an error; its words are the engine's.
  expect((await ui.find({ type: 'Text', text: /conectores:/ }))?.text).toMatch(/^No pude leer los conectores: .+/)
  expect((await ui.find({ type: 'Text', text: /control remoto:/ }))?.text).toMatch(/^No pude leer o cambiar el control remoto: .+/)
  expect(await ui.find({ type: 'Button', text: /^(Activar|Desactivar)$/ })).toBeUndefined()
  await ui.unmount()
})

test("a turn that touched no session tool reads only git again, not the app's servers", async ($, on) => {
  const git: Record<string, string> = {}
  const { calls } = app(on, { state: 'off' }, 0, git)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)
  const before = calls.length

  git['git branch --show-current'] = 'main\n'
  await $.turn.start({ text: 'lee el README', turnId: 't1' })
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: 'README.md' })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  await settled($, /^main$/)
  expect(calls.length).toBe(before)
})

test("a turn that used one of the app's session tools reads the app's servers again", async ($, on) => {
  const remote = { state: 'off' }
  const { calls } = app(on, remote, 0)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)

  remote.state = 'on'
  await $.turn.start({ text: 'activa remote control', turnId: 't2' })
  await $.tool.call({ tool: 'mcp__ccd_session_mgmt__set_remote_control', tool_use_id: 's1', session_id: 'self', enabled: true })
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  for (let i = 0; i < 50 && calls.filter(c => c.tool === 'get_session').length < 2; i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 5))
  expect(calls.filter(c => c.tool === 'get_session').length).toBe(2)
})

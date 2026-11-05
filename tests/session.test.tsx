import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { connectorsLabel, envLabel, parseConnectors, parseRemote, parseSession, pathOf } from '../hooks/session'
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
function app(on: On, remote: { state: string }, isUnreachable = false) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  on('fs.exists', () => ({ value: false }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'E:\\Proyectos\\app' }))
  on('process.run', (_, e) =>
    e.argv.join(' ') === 'git branch --show-current'
      ? { value: { exitCode: 0, stdout: 'feat/login\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
  )
  on('mcp.call', (_, e) => {
    calls.push(e)
    if (isUnreachable) throw new Error('server not connected')
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

test('the session section reads the app servers and names what it found', () => {
  expect(parseConnectors(CONNECTORS)).toEqual([
    { name: 'engram', status: 'connected', tools: 19 },
    { name: 'Claude Docs', status: 'connected', tools: 8 },
    { name: 'Gmail', status: 'needs_auth' },
  ])
  expect(parseConnectors({})).toBeUndefined()
  expect(parseSession({ isRemote: false, remoteControlState: 'off' })).toEqual({ environment: 'Local', remote: 'off' })
  expect(parseSession({ isRemote: true, remoteControlActive: true })).toEqual({ environment: 'Nube', remote: 'on' })
  expect(parseRemote([{ type: 'text', text: '{"state":"connecting"}' }])).toBe('connecting')
  expect(parseRemote([{ type: 'text', text: 'Remote Control is now on.' }])).toBe('on')
  expect(parseRemote([{ type: 'text', text: 'nothing' }])).toBeUndefined()

  const view = { ...NO_SESSION, isLoaded: true, environment: 'Local', branch: 'main', connectors: parseConnectors(CONNECTORS) ?? [] }
  expect(envLabel(false)).toBe('▸ Entorno')
  expect(envLabel(true)).toBe('▾ Entorno')
  expect(pathOf([{ type: 'text', text: '{"path":"E:\\\\Proyectos\\\\otro"}' }])).toBe('E:\\Proyectos\\otro')
  expect(pathOf([{ type: 'text', text: 'Access granted to C:\\Users\\davsh\\code.' }])).toBe('C:\\Users\\davsh\\code')
  expect(pathOf([{ type: 'text', text: 'Granted /home/me/app' }])).toBe('/home/me/app')
  expect(pathOf([{ type: 'text', text: 'The user cancelled the picker' }])).toBeUndefined()
  expect(connectorsLabel(true, view)).toBe('▾ Conectores · 2')
})

test('the pane opens with the session first: environment, connectors, then Remote Control, above upgrades', async ($, on) => {
  app(on, { state: 'off' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => b.text)
  expect(buttons.slice(0, 4)).toEqual(['▸ Entorno', '▸ Conectores · 2', 'Activar', '▾ Actualizaciones'])

  await ui.press({ key: 'section-env' })
  expect((await ui.find({ type: 'Text', text: /^Entorno/ }))?.text).toBe('Entorno Local')
  expect((await ui.find({ type: 'Button', key: 'env-folder' }))?.text).toBe('E:\\Proyectos\\app')
  expect((await ui.find({ type: 'Button', key: 'env-branch' }))?.text).toBe('feat/login')

  await ui.press({ key: 'section-connectors' })
  expect((await ui.find({ type: 'Text', text: /engram/ }))?.text).toBe('● engram · 19 herramientas')
  expect((await ui.find({ type: 'Text', text: /Gmail/ }))?.text).toBe('Gmail (needs_auth)')
  await ui.unmount()
})

test('the Remote Control switch turns it on through the app, then off again', async ($, on) => {
  const { calls } = app(on, { state: 'off' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'remote-switch' })
  await ui.unmount()
  await settled($, /^Desactivar$/)
  expect(calls.filter(c => c.tool === 'set_remote_control').map(c => c.args)).toEqual([{ session_id: 'self', enabled: true }])

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Control remoto/ }))?.text).toBe('Control remoto · activado')
  await ui.press({ key: 'remote-switch' })
  await ui.unmount()
  await settled($, /^Activar$/)
  expect(calls.filter(c => c.tool === 'set_remote_control').map(c => c.args.enabled)).toEqual([true, false])
})

test('the folder picks a new working folder and moves there; the branch opens a terminal in the folder', async ($, on) => {
  const { calls } = app(on, { state: 'off' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Conectores · 2/)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'section-env' })
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

test('a server the mod cannot reach says why instead of staying empty', async ($, on) => {
  app(on, { state: 'off' }, true)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($, /Entorno/)
  for (let i = 0; i < 50; i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 5))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'section-connectors' })
  // A failed call reaches the plugin as an error; its words are the engine's.
  expect((await ui.find({ type: 'Text', text: /conectores:/ }))?.text).toMatch(/^No pude leer los conectores: .+/)
  expect((await ui.find({ type: 'Text', text: /control remoto:/ }))?.text).toMatch(/^No pude leer o cambiar el control remoto: .+/)
  expect(await ui.find({ type: 'Button', text: /^(Activar|Desactivar)$/ })).toBeUndefined()
  await ui.unmount()
})

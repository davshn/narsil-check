import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { connectorLine, connectorsLabel, envLabel, fixGlyph, parseConnectors, parsePr, parseRemote, parseSession, pathOf, repositoryLabel, switchGlyph, webUrlOf } from '../hooks/session'
import { NO_SESSION } from '../hooks/session'
import { pullSummary } from '../hooks/words'

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
// `pr`: the pull request bound to the session, as ccd_pr's get_status
// answers it; none bound when left out.
function app(on: On, remote: { state: string }, failures = 0, git: Record<string, string> = {}, pr?: { state: string; autoFix: boolean }) {
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
    if (e.tool === 'get_status') {
      if (!pr) return text({ bound: false, message: 'No pull request is bound to this session.', monitor: { auto_archive_on_close: false } })
      return text({
        bound: true,
        pr: { number: 2, url: 'https://github.com/davshn/app/pull/2', repo: 'davshn/app', state: pr.state, base: 'main', head: 'feat/login' },
        checks: { available: true, passing: 0, failing: 0, pending: 1, skipped: 0, failingChecks: [] },
        monitor: { auto_fix: pr.autoFix, address_comments: pr.autoFix, auto_merge: false, auto_archive_on_close: false },
      })
    }
    if (e.tool === 'set_monitor') {
      if (pr) pr.autoFix = e.args.auto_fix === true
      return text({ ok: true })
    }
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

// Starts the session and lets the delayed first read of the app's servers run.
async function opened($: Engine, on: On) {
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await clock.advance(10_000)
  await settled($, /Conectores · 2/)
  return clock
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

// The Auto-fix switch's word once it reads `word`, or as it is after a
// while; undefined when there is no switch to press.
async function fixSwitch($: Engine, word?: string): Promise<string | undefined> {
  let found: string | undefined
  for (let i = 0; i < 100; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    found = (await ui.find({ type: 'Button', key: 'fix-switch' }))?.text
    await ui.unmount()
    if (word === undefined || found === word) return found
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
  return found
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

test("Auto-fix is read from the session's bound pull request: only an open one can be switched", () => {
  const status = (state: string, autoFix: boolean) => ({ bound: true, pr: { url: 'https://github.com/o/r/pull/2', state }, monitor: { auto_fix: autoFix } })
  expect(parsePr(status('open', true))).toEqual({ autofix: 'on', prUrl: 'https://github.com/o/r/pull/2' })
  expect(parsePr(status('open', false))).toEqual({ autofix: 'off', prUrl: 'https://github.com/o/r/pull/2' })
  expect(parsePr(status('merged', true))).toEqual({ autofix: 'none' })
  expect(parsePr({ bound: false, monitor: {} })).toEqual({ autofix: 'none' })
  expect(parsePr('nothing')).toBeUndefined()

  const view = { ...NO_SESSION, isLoaded: true }
  expect(fixGlyph({ ...view, autofix: 'off' })).toEqual({ knob: '●━━', color: '#8A90A6', word: 'desactivado' })
  expect(fixGlyph({ ...view, autofix: 'on' })).toEqual({ knob: '━━●', color: '#22B573', word: 'activado' })
  expect(fixGlyph({ ...view, autofix: 'on', isFixSwitching: true })).toEqual({ knob: '━●━', color: '#F5B400', word: 'cambiando…' })
  expect(fixGlyph({ ...view, autofix: 'none' })).toEqual({ knob: '●━━', color: '#8A90A6', word: 'sin PR abierto' })
})

test("the Auto-fix switch, as Remote Control's, turns the PR's CI monitor on through the app, then off again", async ($, on) => {
  const { calls } = app(on, { state: 'off' }, 0, {}, { state: 'open', autoFix: false })
  await opened($, on)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: 'Auto-fix' }))).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'fix-switch' }))?.text).toBe('desactivado')
  await ui.press({ key: 'fix-switch' })
  await ui.unmount()
  expect(await fixSwitch($, 'activado')).toBe('activado')
  expect(calls.filter(c => c.tool === 'set_monitor').map(c => [c.server, c.args])).toEqual([
    ['ccd_pr', { auto_fix: true, address_comments: true, url: 'https://github.com/davshn/app/pull/2' }],
  ])

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'fix-switch' }))?.text).toBe('activado')
  // Remote Control stays as it was.
  expect((await ui.find({ type: 'Button', key: 'remote-switch' }))?.text).toBe('desactivado')
  await ui.press({ key: 'fix-switch' })
  await ui.unmount()
  expect(await fixSwitch($, 'desactivado')).toBe('desactivado')
  expect(calls.filter(c => c.tool === 'set_monitor').map(c => c.args.auto_fix)).toEqual([true, false])
})

// What gh answers for the open PR's CI: one run of the branch's newest
// commit, its steps as given.
const RUN_LIST = 'gh run list --repo davshn/app --branch feat/login --json databaseId,headSha,workflowName,status,conclusion --limit 20'
const RUN_VIEW = 'gh run view 11 --repo davshn/app --json jobs'
function ciGit(status: string, conclusion: string, steps: [string, string, string][]): Record<string, string> {
  return {
    [RUN_LIST]: JSON.stringify([
      { databaseId: 11, headSha: 'abc', workflowName: 'CI', status, conclusion },
      { databaseId: 9, headSha: 'old', workflowName: 'CI', status: 'completed', conclusion: 'failure' },
    ]),
    [RUN_VIEW]: JSON.stringify({
      jobs: [{ name: 'quality', status, conclusion, steps: [['Set up job', 'completed', 'success'], ...steps].map(([name, s, c], i) => ({ name, status: s, conclusion: c, number: i + 1 })) }],
    }),
    'git rev-parse @{upstream}': 'abc\n',
  }
}

// The texts of the pane once `pattern` shows on a button, as Entorno draws them.
async function shown($: Engine, pattern: RegExp): Promise<{ buttons: string[]; texts: string[] }> {
  let buttons: string[] = []
  let texts: string[] = []
  for (let i = 0; i < 100; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    buttons = (await ui.findAll({ type: 'Button' })).map(b => b.text)
    texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    await ui.unmount()
    if (buttons.some(b => pattern.test(b))) break
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
  return { buttons, texts }
}

test("the CI fold, under Remote Control, shows the PR's run step by step and follows it until it ends", async ($, on) => {
  const git = ciGit('in_progress', '', [
    ['Checkout', 'completed', 'success'],
    ['Lint', 'completed', 'success'],
    ['Typecheck', 'in_progress', ''],
    ['Build', 'queued', ''],
    ['Post Checkout', 'queued', ''],
  ])
  const { calls } = app(on, { state: 'off' }, 0, git, { state: 'open', autoFix: false })
  const clock = await opened($, on)

  let pane = await shown($, /CI · 2\/4/)
  expect(pane.buttons.slice(0, 6)).toEqual(['▾ Entorno', 'E:\\Proyectos\\app', 'feat/login', 'desactivado', '▾ CI · 2/4 · Typecheck', 'desactivado'])
  expect(pane.texts.filter(t => /^ {2}[✓◐○✗–] /.test(t))).toEqual(['  ✓ Checkout', '  ✓ Lint', '  ◐ Typecheck', '  ○ Build'])
  expect(calls.filter(c => c.tool === 'get_status').length).toBe(1)

  // While it runs, gh is asked again every ten seconds, without the app.
  Object.assign(git, ciGit('completed', 'success', [
    ['Checkout', 'completed', 'success'],
    ['Lint', 'completed', 'success'],
    ['Typecheck', 'completed', 'success'],
    ['Build', 'completed', 'success'],
  ]))
  await clock.advance(10_000)
  pane = await shown($, /CI · pasó/)
  expect(pane.buttons).toContain('▾ CI · pasó')
  expect(pane.texts.filter(t => /^ {2}[✓◐○✗–] /.test(t))).toEqual(['  ✓ Checkout', '  ✓ Lint', '  ✓ Typecheck', '  ✓ Build'])
  expect(calls.filter(c => c.tool === 'get_status').length).toBe(1)
})

test('the CI fold folds its steps away and stays folded', async ($, on) => {
  app(on, { state: 'off' }, 0, ciGit('completed', 'failure', [['Lint', 'completed', 'failure']]), { state: 'open', autoFix: false })
  await opened($, on)
  await shown($, /CI · falló/)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: '  ✗ Lint' }))?.text).toBe('  ✗ Lint')
  await ui.press({ key: 'section-ci' })
  await ui.unmount()
  const pane = await shown($, /▸ CI · falló/)
  expect(pane.buttons).toContain('▸ CI · falló')
  expect(pane.texts).not.toContain('  ✗ Lint')

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'section-ci' })
  await ui.unmount()
  expect((await shown($, /▾ CI · falló/)).texts).toContain('  ✗ Lint')
})

test('a CI gh cannot read says why in its fold', async ($, on) => {
  app(on, { state: 'off' }, 0, {}, { state: 'open', autoFix: false })
  await opened($, on)
  const pane = await shown($, /CI · sin leer/)
  expect(pane.buttons).toContain('▾ CI · sin leer')
  expect(pane.texts.some(t => /^No pude leer el CI con gh: /.test(t))).toBe(true)
})

test('with no open pull request, Auto-fix says so and cannot be pressed', async ($, on) => {
  app(on, { state: 'off' })
  await opened($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'fix-switch' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'sin PR abierto' }))?.text).toBe('sin PR abierto')
  await ui.unmount()
})

test('a turn that opened or pushed a pull request reads the app again: its PR shows in Auto-fix', async ($, on) => {
  // A merged PR from before: nothing to switch until the turn opens a new one.
  const pr = { state: 'merged', autoFix: false }
  app(on, { state: 'off' }, 0, {}, pr)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await opened($, on)
  expect(await fixSwitch($)).toBeUndefined()

  pr.state = 'open'
  await $.turn.start({ text: 'abre el PR', turnId: 't3' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'gh pr create --fill' })
  await $.turn.complete({ turnId: 't3', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  expect(await fixSwitch($, 'desactivado')).toBe('desactivado')
})

test('a pull request the app binds after the turn ends still shows: the read is tried again a few times', async ($, on) => {
  // The app binds the new PR only after the turn that opened it has ended.
  const pr = { state: 'merged', autoFix: false }
  const { calls } = app(on, { state: 'off' }, 0, {}, pr)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const clock = await opened($, on)

  await $.turn.start({ text: 'abre el PR', turnId: 't4' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'gh pr create --fill' })
  await $.turn.complete({ turnId: 't4', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(await fixSwitch($)).toBeUndefined()

  pr.state = 'open'
  await clock.advance(5_000)
  await clock.settle()
  expect(await fixSwitch($, 'desactivado')).toBe('desactivado')

  // Once the PR shows, the app is asked no more.
  const asked = calls.filter(c => c.tool === 'get_status').length
  await clock.advance(60_000)
  await clock.settle()
  expect(calls.filter(c => c.tool === 'get_status').length).toBe(asked)
})

test('a turn that opened a pull request the app never binds asks the app again only a few times', async ($, on) => {
  const { calls } = app(on, { state: 'off' }, 0, {}, { state: 'merged', autoFix: false })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const clock = await opened($, on)
  const before = calls.filter(c => c.tool === 'get_status').length

  await $.turn.start({ text: 'pushea', turnId: 't5' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'git push -u origin feat/login' })
  await $.turn.complete({ turnId: 't5', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  for (let i = 0; i < 10; i++) {
    await clock.advance(60_000)
    await clock.settle()
  }
  // The read as the turn ends, then three more.
  expect(calls.filter(c => c.tool === 'get_status').length - before).toBe(4)
  expect(await fixSwitch($)).toBeUndefined()
})

test('the pane opens with the session first: Entorno unfolded, then Conectores folded, above upgrades', async ($, on) => {
  app(on, { state: 'off' })
  await opened($, on)

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
  await opened($, on)

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
  await opened($, on)

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

test("the app's servers are first asked ten seconds after the session starts, once; a failed read is tried again as the first turn starts", async ($, on) => {
  const clock = mock.clock(on)
  // The first read fails (three calls) before the app's servers answer.
  const { calls } = app(on, { state: 'off' }, 3)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await clock.advance(9_000)
  expect(calls.length).toBe(0)

  await clock.advance(1_000)
  await clock.settle()
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 5))
  expect(calls.length).toBe(3)
  // No quick retries: the section reads, with no error, until the turn starts.
  await clock.advance(60_000)
  await clock.settle()
  expect(calls.length).toBe(3)
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Leyendo/ }))?.text).toBe('Leyendo la sesión…')
  await ui.unmount()

  await $.turn.start({ text: 'hola', turnId: 't0' })
  await settled($, /Conectores · 2/)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'env-branch' }))?.text).toBe('feat/login')
  expect(await ui.find({ type: 'Text', text: /No pude/ })).toBeUndefined()
  await ui.unmount()
})

test('the session is read again as each main turn ends: a branch switched in the turn shows', async ($, on) => {
  const git: Record<string, string> = {}
  app(on, { state: 'off' }, 0, git)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await opened($, on)

  git['git branch --show-current'] = 'main\n'
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  await settled($, /^main$/)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'env-branch' }))?.text).toBe('main')
  await ui.unmount()
})

test('a server the mod cannot reach says why once the first turn has tried it too', async ($, on) => {
  const clock = mock.clock(on)
  const { calls } = app(on, { state: 'off' }, Number.POSITIVE_INFINITY)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await clock.advance(10_000)
  await clock.settle()
  await $.turn.start({ text: 'hola', turnId: 't0' })
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 5))
  // Two reads in all, each asking every server once.
  expect(calls.filter(c => c.tool === 'get_session').length).toBe(2)
  expect(calls.filter(c => c.server === 'ccd_connectors').length).toBe(2)
  expect(calls.filter(c => c.tool === 'get_status').length).toBe(2)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /control remoto:/ }))?.text).toMatch(/^No pude leer o cambiar el control remoto: .+/)
  await ui.press({ key: 'section-connectors' })
  // A failed call reaches the plugin as an error; its words are the engine's.
  expect((await ui.find({ type: 'Text', text: /conectores:/ }))?.text).toMatch(/^No pude leer los conectores: .+/)
  expect(await ui.find({ type: 'Button', text: /^(Activar|Desactivar)$/ })).toBeUndefined()
  await ui.unmount()
})

test("a turn that touched no session tool reads only git again, not the app's servers", async ($, on) => {
  const git: Record<string, string> = {}
  const { calls } = app(on, { state: 'off' }, 0, git)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await opened($, on)
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
  await opened($, on)

  remote.state = 'on'
  await $.turn.start({ text: 'activa remote control', turnId: 't2' })
  await $.tool.call({ tool: 'mcp__ccd_session_mgmt__set_remote_control', tool_use_id: 's1', session_id: 'self', enabled: true })
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  for (let i = 0; i < 50 && calls.filter(c => c.tool === 'get_session').length < 2; i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 5))
  expect(calls.filter(c => c.tool === 'get_session').length).toBe(2)
})

test('"Actualizar rama", last in the pane, pulls the checked-out branch with a rebase and says how it went', async ($, on) => {
  const git: Record<string, string> = { 'git pull -r': 'Successfully rebased and updated refs/heads/feat/login.\n' }
  app(on, { state: 'off' }, 0, git)
  await opened($, on)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(buttons.at(-1)).toBe('branch-pull')
  // Centered across the pane, under the last section.
  expect((await ui.find({ type: 'Box', key: 'pull' }))?.props.justifyContent).toBe('center')
  await ui.press({ key: 'branch-pull' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Rama feat\/login/ }))?.text).toBe('Rama feat/login actualizada: rebase hecho')
  await ui.unmount()
})

test('the words of each pull that went well', () => {
  expect(pullSummary('Current branch main is up to date.\n')).toBe('ya estaba al día')
  expect(pullSummary('Already up to date.\n')).toBe('ya estaba al día')
  expect(pullSummary('Successfully rebased and updated refs/heads/main.\n')).toBe('rebase hecho')
  expect(pullSummary('Updating 1a2b3c4..5d6e7f8\nFast-forward\n')).toBe('Fast-forward')
})

test('a pull that fails says why', async ($, on) => {
  app(on, { state: 'off' }, 0)
  await opened($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'branch-pull' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await again.find({ type: 'Text', text: /^No pude actualizar/ }))?.text).toMatch(/^No pude actualizar la rama: /)
  await again.unmount()
})

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BACKGROUND_MAX_MS, expired, kept } from '../hooks/map/board'
import { PALETTE } from '../hooks/words'
import type { MapEntry } from '../types'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOTICE = (id: string, status: string) =>
  `<task-notification><task-id>${id}</task-id><status>${status}</status><summary>private words</summary></task-notification>`

/** The map section as the desktop pane draws it, once the map's writes and its redraw have landed. */
async function map($: Engine) {
  await new Promise<void>(resolve => setTimeout(() => resolve(), 30))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = (await ui.findAll({ type: 'Svg' }))[0]
  const panel = await ui.find({ type: 'Box', key: 'panel-map' })
  await ui.unmount()
  const source = String(svg?.props.source)
  return { alt: String(svg?.props.alt), source, tone: panel?.props.borderColor, dots: source.split('font-weight="700"').length - 1 }
}

test('a refused call turns the map red with a dot on its station, and the next message clears it', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.sleep', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('classic.PreToolUse', () => ({ deny: 'JUDGE: found key sk-private' }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Show status' })
  let seen = await map($)
  expect(seen.tone).toBe(PALETTE.error)
  // One dot on Terminal, one on Hooks: the call and the hook that stopped it.
  expect(seen.dots).toBe(2)
  // The refusal's words never reach the map.
  expect(seen.source).not.toContain('sk-private')
  expect(seen.alt).not.toContain('sk-private')

  await $.turn.start({ text: 'next', turnId: 't2' } as never)
  seen = await map($)
  expect(seen.dots).toBe(0)
  expect(seen.tone).toBe(PALETTE.done)
})

test('a failed call is a fault; an interrupted turn is none, and it settles a call that never reported back', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.sleep', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  // A Read never answers, as a call the person interrupted.
  on('tool.call', (_, e) => (e.tool === 'Read' ? new Promise(() => {}) : ({ result: {}, isError: true } as never)))

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Show status' })
  // Never answers: its rejection when the test ends is no failure of the map.
  $.tool.call({ tool: 'Read', file_path: '/a/b/c.ts' }).catch(() => undefined)
  expect((await map($)).alt).toBe('Mapa mental. Archivos: b/c.ts')

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)
  const seen = await map($)
  expect(seen.dots).toBe(1)
  expect(seen.alt).toBe('Mapa mental. No hay nada en ejecución.')
})

test('a command sent to the background runs past its turn until its own notification, and a failed one leaves a fault', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.sleep', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  let task = 'b1'
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: task } }) as never)

  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Wait for the build', run_in_background: true })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect((await map($)).alt).toBe('Mapa mental. Terminal: Wait for the build')

  // Another task's notification leaves it alone.
  await $.turn.start({ text: NOTICE('other', 'completed'), turnId: 't2' } as never)
  expect((await map($)).alt).toBe('Mapa mental. Terminal: Wait for the build')

  await $.turn.start({ text: NOTICE('b1', 'completed'), turnId: 't3' } as never)
  let seen = await map($)
  expect(seen.alt).toBe('Mapa mental. No hay nada en ejecución.')
  expect(seen.dots).toBe(0)
  // A notification is no message of the person's, and its words stay off the map.
  expect(seen.source).not.toContain('private words')

  task = 'b2'
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build', run_in_background: true })
  await $.turn.start({ text: NOTICE('b2', 'failed'), turnId: 't4' } as never)
  seen = await map($)
  expect(seen.dots).toBe(1)
  expect(seen.tone).toBe(PALETTE.error)
})

test('a background task that never reports back is closed at the end of a turn once it is an hour old', async ($, on) => {
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  on('clock.sleep', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b9' } }) as never)

  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Follow the log', run_in_background: true })
  now += BACKGROUND_MAX_MS - 1
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect((await map($)).alt).toBe('Mapa mental. Terminal: Follow the log')

  now += 1
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  const seen = await map($)
  expect(seen.alt).toBe('Mapa mental. No hay nada en ejecución.')
  expect(seen.tone).toBe(PALETTE.done)
})

test('a subagent circles the agents station until its loop ends', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.sleep', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }))

  // A call of the subagent's puts it on the agents station.
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' } as never)
  expect((await map($)).source).toContain('animateTransform')

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' } as never)
  const seen = await map($)
  expect(seen.source).not.toContain('animateTransform')
  expect(seen.alt).toBe('Mapa mental. No hay nada en ejecución.')
})

test('a burst of calls is one redraw of the map, made once the wait is over', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const waits: (() => void)[] = []
  on('clock.sleep', () => new Promise(resolve => waits.push(() => resolve({ value: undefined }))))
  on('tool.call', () => ({ result: {} }))

  for (const file of ['a', 'b', 'c']) await $.tool.call({ tool: 'Read', file_path: `/p/${file}.ts` })
  // Six writes of the board, one wait: the pane has not redrawn yet.
  let seen = await map($)
  expect(waits.length).toBe(1)
  expect(seen.source).not.toContain('>3</text>')

  waits[0]?.()
  seen = await map($)
  // Archivos counts the three calls.
  expect(seen.source).toContain('>3</text>')
})

test('a tool never waits on the map', async ($, on) => {
  // A clock that never answers holds every write of the map.
  on('clock.now', () => new Promise(() => {}))
  on('tool.call', () => ({ result: { ok: true } }))
  expect(await $.tool.call({ tool: 'Read', file_path: '/p/a.ts' })).toMatchObject({ result: { ok: true } })
})

test('the board keeps its newest entries and only the newest background tasks beyond them', () => {
  const entry = (i: number, more: Partial<MapEntry> = {}): MapEntry => ({ id: String(i), station: 'shell', label: 'x', from: 'core', startedAt: i, status: 'ok', ...more })
  const background = Array.from({ length: 30 }, (_, i) => entry(i, { status: 'run', task: `t${i}` }))
  const recent = Array.from({ length: 80 }, (_, i) => entry(100 + i))
  const all = kept([...background, ...recent])
  expect(all.length).toBe(96)
  expect(all.slice(0, 16).map(e => e.task)).toEqual(background.slice(-16).map(e => e.task))
  expect(all.slice(16)).toEqual(recent)

  const old = entry(0, { status: 'run', task: 'old' })
  const young = entry(BACKGROUND_MAX_MS, { status: 'run', task: 'young' })
  const closed = expired([old, young, entry(1, { status: 'run' })], BACKGROUND_MAX_MS)
  expect(closed.map(e => e.status)).toEqual(['ok', 'run', 'run'])
  expect(closed[0]?.endedAt).toBe(BACKGROUND_MAX_MS)
})

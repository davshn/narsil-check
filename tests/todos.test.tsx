import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { findTask, parseEntry, parseTodos, serializeTodos, templateArg, templateMatches, todosLabel, withExclude } from '../hooks/todos'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const LIST = 'E:/Proyectos/app/.atl/narsil-check/pendientes.json'
const EXCLUDE = 'E:/Proyectos/app/.git/info/exclude'

// A project at E:/Proyectos/app beside two templates, its files in memory.
// `readOnly`: paths whose write fails, as a locked or read-only file does.
function project(on: On, files: Record<string, string> = {}, readOnly: string[] = []) {
  const fs = new Map(Object.entries(files))
  const prompts: string[] = []
  const toasts: string[] = []
  // The engine hands paths over as the system writes them (E:\Proyectos\app):
  // they are compared with forward slashes.
  const at = (path: string) => path.replace(/\\/g, '/')
  on('fs.exists', (_, e) => ({ value: fs.has(at(e.path)) || [...fs.keys()].some(k => k.startsWith(`${at(e.path)}/`)) }))
  on('fs.read', (_, e) => {
    const text = fs.get(at(e.path))
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    if (readOnly.includes(at(e.path))) throw new Error(`EPERM: ${e.path}`)
    fs.set(at(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', (_, e) =>
    at(e.path ?? '') === 'E:/Proyectos'
      ? { value: ['app', 'backendTemplate', 'backend-api', 'mobileTemplate'].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
      : { value: [] },
  )
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    const out =
      cmd === 'git rev-parse --show-toplevel' ? `${e.init?.cwd ? at(e.init.cwd) : 'E:/Proyectos/app'}\n` : cmd === 'git rev-parse --git-path info/exclude' ? '.git/info/exclude\n' : undefined
    return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__narsil-check__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'E:/Proyectos/app' }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: 'not in the desktop app' }], isError: true } }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  return { fs, prompts, toasts }
}

// What a tool answered, as the model reads it.
const textOf = (r: { result?: unknown }) => (r.result as { content: { text: string }[] }).content[0]?.text

const saved = (tasks: { id: string; name: string; content?: string }[]) => serializeTodos(tasks)

// Waits a bounded while for the pane to draw a Button keyed `key`.
async function until($: Engine, key: string) {
  for (let i = 0; i < 100; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const found = await ui.find({ type: 'Button', key })
    await ui.unmount()
    if (found) return
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
}

test('the list file is read leniently and an entry splits at its first colon', () => {
  expect(parseTodos(undefined)).toEqual([])
  expect(parseTodos('not json')).toEqual([])
  expect(parseTodos('{"version":1,"tasks":[{"id":"a","name":" Uno ","content":" x "},{"name":""},{"id":"b","name":"Dos"}]}')).toEqual([
    { id: 'a', name: 'Uno', content: 'x' },
    { id: 'b', name: 'Dos' },
  ])
  expect(parseTodos(serializeTodos([{ id: 'a', name: 'Uno' }]))).toEqual([{ id: 'a', name: 'Uno' }])

  expect(parseEntry('Subir TypeScript: revisar los tipos: y el build')).toEqual({ name: 'Subir TypeScript', content: 'revisar los tipos: y el build' })
  expect(parseEntry('Revisar el README')).toEqual({ name: 'Revisar el README' })
  expect(parseEntry('Revisar:   ')).toEqual({ name: 'Revisar' })
  expect(parseEntry('  : solo contenido')).toBeUndefined()

  expect(findTask([{ id: 'a1', name: 'Revisar el README' }], 'revisar el readme')?.id).toBe('a1')
  expect(todosLabel(false, 0)).toBe('▸ Pendientes')
  expect(todosLabel(true, 2)).toBe('▾ Pendientes · 2')
})

test('the exclude line is added once, and a template is found by its folder name', () => {
  expect(withExclude('')).toBe('/.atl/narsil-check/\n')
  expect(withExclude('# git ls-files --others\n*.log')).toBe('# git ls-files --others\n*.log\n/.atl/narsil-check/\n')
  expect(withExclude('*.log\n/.atl/narsil-check/\n')).toBeUndefined()

  const folders = ['app', 'backendTemplate', 'backend-api', 'mobileTemplate']
  expect(templateMatches(folders, 'backendtemplate')).toEqual(['backendTemplate'])
  expect(templateMatches(folders, 'backend')).toEqual(['backendTemplate', 'backend-api'])
  expect(templateMatches(folders, 'landing')).toEqual([])

  expect(templateArg('template "en backendTemplate crea la tarea"')).toBe('en backendTemplate crea la tarea')
  expect(templateArg('template')).toBe('')
  expect(templateArg('upgrade')).toBeUndefined()
})

test('Pendientes starts folded when empty; a task added in the field is saved, kept out of git, and shown', async ($, on) => {
  const { fs } = project(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await until($, 'section-todos')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'section-todos' }))?.text).toBe('▸ Pendientes')
  await ui.press({ key: 'section-todos' })
  await ui.input({ key: 'todo-new', text: 'Subir TypeScript: revisar los tipos' })
  await ui.input({ key: 'todo-new', text: 'Revisar el README' })
  expect((await ui.find({ type: 'Button', key: 'section-todos' }))?.text).toBe('▾ Pendientes · 2')
  await ui.unmount()

  const tasks = parseTodos(fs.get(LIST))
  expect(tasks.map(t => [t.name, t.content])).toEqual([
    ['Subir TypeScript', 'revisar los tipos'],
    ['Revisar el README', undefined],
  ])
  expect(fs.get(EXCLUDE)).toBe('/.atl/narsil-check/\n')
})

test('a saved list opens Pendientes; the name shows the content and ○ finishes the task', async ($, on) => {
  const { fs } = project(on, {
    [LIST]: saved([
      { id: 't1', name: 'Subir TypeScript', content: 'Cambia moduleResolution' },
      { id: 't2', name: 'Revisar el README' },
    ]),
    [EXCLUDE]: '/.atl/narsil-check/\n',
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await until($, 'todo-t1')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'section-todos' }))?.text).toBe('▾ Pendientes · 2')
  expect((await ui.find({ type: 'Button', key: 'todo-t1' }))?.text).toBe('▸ Subir TypeScript')
  // A task with no content is plain text: there is nothing to show.
  expect(await ui.find({ type: 'Button', key: 'todo-t2' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Cambia moduleResolution' })).toBeUndefined()

  await ui.press({ key: 'todo-t1' })
  expect((await ui.find({ type: 'Text', text: 'Cambia moduleResolution' }))?.text).toBe('Cambia moduleResolution')
  expect(parseTodos(fs.get(LIST))).toHaveLength(2)

  await ui.press({ key: 'todo-done-t1' })
  expect(await ui.find({ type: 'Button', key: 'todo-t1' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'section-todos' }))?.text).toBe('▾ Pendientes · 1')
  await ui.unmount()
  expect(parseTodos(fs.get(LIST))).toEqual([{ id: 't2', name: 'Revisar el README' }])
  // Already excluded: the line is not added twice.
  expect(fs.get(EXCLUDE)).toBe('/.atl/narsil-check/\n')
})

test("Claude's tools list, add and finish tasks, and a change made elsewhere is kept", async ($, on) => {
  const { fs } = project(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const added = await $.tool.call({ tool: 'mcp__narsil-check__todo_add', tool_use_id: 'u1', name: 'Revisar el README', content: 'Faltan los comandos' })
  expect(textOf(added)).toMatch(/^Added \[\w+\] Revisar el README\.$/)

  // Another session writes its own task to the same file meanwhile.
  const mine = parseTodos(fs.get(LIST))
  fs.set(LIST, saved([...mine, { id: 'x1', name: 'Tarea de otra sesión' }]))

  const listed = await $.tool.call({ tool: 'mcp__narsil-check__todo_list', tool_use_id: 'u2' })
  expect(textOf(listed)).toBe(`- [${mine[0]?.id}] Revisar el README\n  Faltan los comandos\n- [x1] Tarea de otra sesión`)

  const done = await $.tool.call({ tool: 'mcp__narsil-check__todo_done', tool_use_id: 'u3', task: 'revisar el readme' })
  expect(textOf(done)).toMatch(/^Removed \[\w+\] Revisar el README\.$/)
  expect(parseTodos(fs.get(LIST))).toEqual([{ id: 'x1', name: 'Tarea de otra sesión' }])

  const missing = await $.tool.call({ tool: 'mcp__narsil-check__todo_done', tool_use_id: 'u4', task: 'nada' })
  expect(textOf(missing)).toBe('No pending task "nada". Call todo_list to see them.')
})

test('a task for a template lands in that folder, and an unclear name asks which one', async ($, on) => {
  const { fs } = project(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const added = await $.tool.call({
    tool: 'mcp__narsil-check__todo_add_to_template',
    tool_use_id: 'u1',
    template: 'BackendTemplate',
    name: 'Subir TypeScript a 7.0.0',
    content: 'En app hubo que cambiar moduleResolution a bundler.',
  })
  expect(textOf(added)).toMatch(/to E:\/Proyectos\/backendTemplate\/\.atl\/narsil-check\/pendientes\.json\.$/)
  expect(parseTodos(fs.get('E:/Proyectos/backendTemplate/.atl/narsil-check/pendientes.json')).map(t => [t.name, t.content])).toEqual([
    ['Subir TypeScript a 7.0.0', 'En app hubo que cambiar moduleResolution a bundler.'],
  ])
  expect(fs.get('E:/Proyectos/backendTemplate/.git/info/exclude')).toBe('/.atl/narsil-check/\n')
  // This project's own list is untouched.
  expect(fs.has(LIST)).toBe(false)

  const unclear = await $.tool.call({ tool: 'mcp__narsil-check__todo_add_to_template', tool_use_id: 'u2', template: 'backend', name: 'x' })
  expect(textOf(unclear)).toBe('Several folders in E:/Proyectos match "backend": backendTemplate, backend-api. Ask the user which one.')
})

test('/narsil-check template hands the request to Claude, who knows how the work was done', async ($, on) => {
  const { prompts, toasts } = project(on)
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

  const ran = await $.command.run({ command: 'narsil-check', args: 'template "en backendTemplate crea la tarea de actualizar TypeScript a 7.0.0"', ...TYPED })
  expect(ran).toMatchObject({ text: 'Narsil Check: le paso la tarea a Claude para la plantilla.' })
  await clock.advance(0)
  for (let i = 0; i < 50 && prompts.length === 0; i++) await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  expect(toasts).toEqual([])
  expect(prompts[0]).toMatch(/^Narsil Check · tarea para una plantilla: «en backendTemplate crea la tarea de actualizar TypeScript a 7\.0\.0»/)
  expect(prompts[0]).toContain('mcp__narsil-check__todo_add_to_template')

  const empty = await $.command.run({ command: 'narsil-check', args: 'template', ...TYPED })
  expect((empty as { text: string }).text).toMatch(/^Narsil Check: escribe la tarea entre comillas/)
})

test('a damaged list is left as it is and said so; the next change keeps a copy of it before starting a new list', async ($, on) => {
  const { fs } = project(on, { [LIST]: '{"tasks": [ broken' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await until($, 'section-todos')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'section-todos' })
  expect((await ui.find({ type: 'Text', text: /no se puede leer/ }))?.text).toBe(
    '.atl/narsil-check/pendientes.json no se puede leer (no es JSON válido). No lo toco: corrígelo, o añade una tarea y guardaré una copia del archivo antes de empezar una lista nueva.',
  )
  // Reading it changed nothing.
  expect(fs.get(LIST)).toBe('{"tasks": [ broken')

  await ui.input({ key: 'todo-new', text: 'Revisar el README' })
  const copies = [...fs.keys()].filter(k => /\/\.atl\/narsil-check\/pendientes\.danado-[\dT-]+Z\.json$/.test(k))
  expect(copies).toHaveLength(1)
  expect(fs.get(copies[0] as string)).toBe('{"tasks": [ broken')
  expect(parseTodos(fs.get(LIST)).map(t => t.name)).toEqual(['Revisar el README'])
  expect((await ui.find({ type: 'Text', text: /estaba dañado/ }))?.text).toMatch(/^\.atl\/narsil-check\/pendientes\.json estaba dañado \(no es JSON válido\): guardé una copia en \.atl\/narsil-check\/pendientes\.danado-.+\.json y empecé una lista nueva\.$/)
  expect(await ui.find({ type: 'Text', text: /no se puede leer/ })).toBeUndefined()
  await ui.unmount()
})

test('Claude is told about a damaged list instead of reading it as empty', async ($, on) => {
  const { fs } = project(on, { [LIST]: '{"version":1}' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const listed = await $.tool.call({ tool: 'mcp__narsil-check__todo_list', tool_use_id: 'u1' })
  expect(textOf(listed)).toBe('.atl/narsil-check/pendientes.json cannot be read (no tiene la lista "tasks"). Tell the user; a change will keep a copy of it and start a new list.')
  const added = await $.tool.call({ tool: 'mcp__narsil-check__todo_add', tool_use_id: 'u2', name: 'Uno' })
  expect(textOf(added)).toMatch(/^Added \[\w+\] Uno\. Note for the user: \.atl\/narsil-check\/pendientes\.json estaba dañado/)
  expect([...fs.values()]).toContain('{"version":1}')
})

test('a git exclude file that cannot be written does not stop the task from being saved', async ($, on) => {
  const { fs } = project(on, {}, [EXCLUDE])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const added = await $.tool.call({ tool: 'mcp__narsil-check__todo_add', tool_use_id: 'u1', name: 'Uno' })
  expect(textOf(added)).toMatch(/^Added \[\w+\] Uno\.$/)
  expect(parseTodos(fs.get(LIST)).map(t => t.name)).toEqual(['Uno'])
  expect(fs.has(EXCLUDE)).toBe(false)
})

test("a list that cannot be written gives Claude a readable error, and the pane a toast", async ($, on) => {
  const { toasts } = project(on, {}, [LIST])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const added = await $.tool.call({ tool: 'mcp__narsil-check__todo_add', tool_use_id: 'u1', name: 'Uno' })
  // The failed write reaches the mod as an error; its words are the engine's.
  expect(textOf(added)).toMatch(/^The Pendientes list could not be changed: .+/)
  expect((added.result as { isError: boolean }).isError).toBe(true)

  await until($, 'section-todos')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'section-todos' })
  await ui.input({ key: 'todo-new', text: 'Dos' })
  await ui.unmount()
  expect(toasts.at(-1)).toMatch(/^No pude guardar Pendientes: .+/)
})

test('a template named by its absolute path is used as given; an unknown one asks the user', async ($, on) => {
  const { fs } = project(on, { 'E:/Proyectos/mobileTemplate/package.json': '{}' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const added = await $.tool.call({ tool: 'mcp__narsil-check__todo_add_to_template', tool_use_id: 'u1', template: 'E:\\Proyectos\\mobileTemplate', name: 'Uno' })
  expect(textOf(added)).toMatch(/to E:\/Proyectos\/mobileTemplate\/\.atl\/narsil-check\/pendientes\.json\.$/)
  expect(parseTodos(fs.get('E:/Proyectos/mobileTemplate/.atl/narsil-check/pendientes.json')).map(t => t.name)).toEqual(['Uno'])

  const gone = await $.tool.call({ tool: 'mcp__narsil-check__todo_add_to_template', tool_use_id: 'u2', template: 'E:/Proyectos/landing', name: 'x' })
  expect(textOf(gone)).toBe('No folder at E:/Proyectos/landing.')
  const unknown = await $.tool.call({ tool: 'mcp__narsil-check__todo_add_to_template', tool_use_id: 'u3', template: 'landing', name: 'x' })
  expect(textOf(unknown)).toBe('No folder named like "landing" in E:/Proyectos. Ask the user which template it is.')
})

test('the mobile app has no text field: an empty list says so, and tasks still finish with ○', async ($, on) => {
  project(on, { [LIST]: saved([{ id: 't1', name: 'Uno' }]) })
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  await until($, 'todo-done-t1')

  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await phone.find({ type: 'Input' })).toBeUndefined()
  await phone.press({ key: 'todo-done-t1' })
  expect((await phone.find({ type: 'Text', text: /No hay tareas/ }))?.text).toBe('No hay tareas pendientes.')
  await phone.unmount()
  // Where the field is drawn, it says enough by itself.
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Text', text: /No hay tareas/ })).toBeUndefined()
  expect(await desk.find({ type: 'Input', key: 'todo-new' })).toBeDefined()
  await desk.unmount()
})

import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { GO, nextMajorPath, parseGoMod, proxyPath } from '../hooks/golang'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'upgrade-mod',
  component: 'Pane',
  requestId: 'upgrades',
  props: { title: 'Actualizaciones', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const GO_MOD = `module example.com/demo

go 1.22

require github.com/go-chi/chi v1.5.4

require (
	github.com/BurntSushi/toml v1.3.2
	github.com/google/uuid v1.6.0
	golang.org/x/text v0.14.0 // indirect
	example.com/forked v1.0.0
	gopkg.in/yaml.v3 v3.0.1
)

replace example.com/forked => ../forked
`

test('go.mod gives its direct requirements, without indirect or replaced ones', () => {
  expect(parseGoMod({ 'go.mod': GO_MOD })).toEqual([
    { name: 'github.com/go-chi/chi', spec: 'v1.5.4', isDev: false, installed: '1.5.4' },
    { name: 'github.com/BurntSushi/toml', spec: 'v1.3.2', isDev: false, installed: '1.3.2' },
    { name: 'github.com/google/uuid', spec: 'v1.6.0', isDev: false, installed: '1.6.0' },
    { name: 'gopkg.in/yaml.v3', spec: 'v3.0.1', isDev: false, installed: '3.0.1' },
  ])
})

test('the proxy spells capitals with "!" and a major past v1 is its own path', () => {
  expect(proxyPath('github.com/BurntSushi/toml')).toBe('github.com/!burnt!sushi/toml')
  expect(nextMajorPath('github.com/go-chi/chi', 'v1.5.5')).toBe('github.com/go-chi/chi/v2')
  expect(nextMajorPath('github.com/go-chi/chi/v2', 'v2.1.0')).toBe('github.com/go-chi/chi/v3')
  expect(nextMajorPath('gopkg.in/yaml.v3', 'v3.0.1')).toBe('gopkg.in/yaml.v4')
  expect(nextMajorPath('example.com/m', 'v0.4.0')).toBe('example.com/m/v2')
})

test("the proxy's answer gives the release and the repository, never a pseudo-version", () => {
  expect(GO.latestOf(JSON.stringify({ Version: 'v1.12.0', Origin: { URL: 'https://github.com/gin-gonic/gin' } }))).toBe('v1.12.0')
  expect(GO.repoUrlOf(JSON.stringify({ Version: 'v1.12.0', Origin: { URL: 'https://github.com/gin-gonic/gin' } }))).toBe('https://github.com/gin-gonic/gin')
  expect(GO.latestOf(JSON.stringify({ Version: 'v0.0.0-20240101120000-abcdef123456' }))).toBeUndefined()
  expect(GO.latestUrl('github.com/BurntSushi/toml')).toBe('https://proxy.golang.org/github.com/!burnt!sushi/toml/@latest')
  expect(GO.importPattern('github.com/google/uuid')).toBe('"github\\.com/google/uuid(/[^"]*)?"')
})

function goProject(on: On, proxy: Record<string, string>) {
  const files: Record<string, string> = { 'go.mod': GO_MOD, 'go.sum': '' }
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
  const asked: string[] = []
  on('http.fetch', (_, e) => {
    const path = e.url.replace('https://proxy.golang.org/', '').replace(/\/@latest$/, '')
    asked.push(path)
    const version = proxy[path]
    return {
      value: version
        ? { status: 200, ok: true, headers: {}, text: JSON.stringify({ Version: version }) }
        : { status: 404, ok: false, headers: {}, text: 'not found' },
    }
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
  const ran: string[][] = []
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: e.argv[0] === 'git' ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { ran, asked }
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

test('a Go module finds majors through every published path, and the button runs go get and go mod tidy', async ($, on) => {
  const { ran, asked } = goProject(on, {
    // As the proxy has them: chi went from v1 to v5 with every major between.
    'github.com/go-chi/chi': 'v1.5.5',
    'github.com/go-chi/chi/v2': 'v2.1.0',
    'github.com/go-chi/chi/v3': 'v3.3.4',
    'github.com/go-chi/chi/v4': 'v4.1.3',
    'github.com/go-chi/chi/v5': 'v5.5.0',
    'github.com/!burnt!sushi/toml': 'v1.6.0',
    'github.com/google/uuid': 'v1.6.0',
    'gopkg.in/yaml.v3': 'v3.0.1',
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('2 para actualizar de 4 · 1 mayores · 1 triviales')
  expect((await ui.find({ type: 'Text', text: /^github.com\/go-chi/ }))?.text).toBe('github.com/go-chi/chi 1.5.4 → v5.5.0')
  // Each next major is asked for until the first one that is not there
  // (after the scan, the release notes ask for the module once more).
  expect(asked.filter(p => p.startsWith('github.com/go-chi/chi')).slice(0, 6)).toEqual([
    'github.com/go-chi/chi',
    'github.com/go-chi/chi/v2',
    'github.com/go-chi/chi/v3',
    'github.com/go-chi/chi/v4',
    'github.com/go-chi/chi/v5',
    'github.com/go-chi/chi/v6',
  ])

  await ui.press({ key: 'upgrade-bumps' })
  expect(ran.filter(argv => argv[0] === 'go')).toEqual([
    ['go', 'get', 'github.com/BurntSushi/toml@v1.6.0'],
    ['go', 'mod', 'tidy'],
  ])
  await ui.unmount()
})

import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { PYPI, importNameOf, normalize, parsePypi, parseRequirement, pinOf, pySpecFor, rewritePypi } from '../hooks/pypi'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'upgrade-mod',
  component: 'Pane',
  requestId: 'upgrades',
  props: { title: 'Actualizaciones', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const PYPROJECT = `[project]
name = "demo"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "requests>=2.31,<3",
    "Django[argon2]~=4.2 ; python_version > '3.8'",
    "PyYAML==6.0.1",
    "pkg @ git+https://github.com/o/pkg",
]

[project.optional-dependencies]
docs = ["mkdocs>=1.5"]

[dependency-groups]
dev = ["pytest>=8.0", "ruff==0.4.4"]
`

const UV_LOCK = `version = 1
requires-python = ">=3.11"

[[package]]
name = "requests"
version = "2.31.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "django"
version = "4.2.11"

[[package]]
name = "pyyaml"
version = "6.0.1"

[[package]]
name = "mkdocs"
version = "1.5.3"

[[package]]
name = "pytest"
version = "8.1.1"

[[package]]
name = "ruff"
version = "0.4.4"
`

const POETRY = `[tool.poetry]
name = "demo"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.110.0"
pydantic = { version = "^2.6", extras = ["email"] }

[tool.poetry.group.dev.dependencies]
black = "^24.2.0"
`

test('a PEP 508 requirement is a name and its specifier, without extras or markers', () => {
  expect(parseRequirement("Django[argon2]~=4.2 ; python_version > '3.8'")).toEqual({ name: 'Django', spec: '~=4.2' })
  expect(parseRequirement('requests >= 2.31, < 3  # http')).toEqual({ name: 'requests', spec: '>=2.31,<3' })
  expect(parseRequirement('flask')).toEqual({ name: 'flask', spec: '' })
  expect(parseRequirement('-r base.txt')).toBeUndefined()
  expect(parseRequirement('pkg @ git+https://github.com/o/pkg')).toBeUndefined()
  expect(parseRequirement('# a comment')).toBeUndefined()
  expect(normalize('Foo_Bar.baz')).toBe('foo-bar-baz')
  expect(pinOf('==2.31.0')).toBe('2.31.0')
  expect(pinOf('>=2.31,<3')).toBe('2.31')
  expect(pinOf('')).toBeUndefined()
})

test('pyproject.toml and uv.lock give every group and the installed version', () => {
  expect(parsePypi({ 'pyproject.toml': PYPROJECT, 'uv.lock': UV_LOCK })).toEqual([
    { name: 'requests', spec: '>=2.31,<3', isDev: false, installed: '2.31.0' },
    { name: 'Django', spec: '~=4.2', isDev: false, installed: '4.2.11' },
    { name: 'PyYAML', spec: '==6.0.1', isDev: false, installed: '6.0.1' },
    { name: 'mkdocs', spec: '>=1.5', isDev: true, installed: '1.5.3' },
    { name: 'pytest', spec: '>=8.0', isDev: true, installed: '8.1.1' },
    { name: 'ruff', spec: '==0.4.4', isDev: true, installed: '0.4.4' },
  ])
})

test("Poetry's tables are read, python left out", () => {
  expect(parsePypi({ 'pyproject.toml': POETRY })).toEqual([
    { name: 'fastapi', spec: '^0.110.0', isDev: false, installed: '0.110.0' },
    { name: 'pydantic', spec: '^2.6', isDev: false, installed: '2.6' },
    { name: 'black', spec: '^24.2.0', isDev: true, installed: '24.2.0' },
  ])
})

test('requirements.txt pins are the installed versions when no lockfile is there', () => {
  expect(parsePypi({ 'requirements.txt': 'requests==2.31.0\n-r other.txt\nnumpy>=1.26\n', 'requirements-dev.txt': 'pytest==8.0.0\n' })).toEqual([
    { name: 'requests', spec: '==2.31.0', isDev: false, installed: '2.31.0' },
    { name: 'numpy', spec: '>=1.26', isDev: false, installed: '1.26' },
    { name: 'pytest', spec: '==8.0.0', isDev: true, installed: '8.0.0' },
  ])
})

test('raising a requirement keeps its operators and upper bound, and every other byte', () => {
  expect(pySpecFor('>=2.31,<3', '2.34.2')).toBe('>=2.34.2,<3')
  expect(pySpecFor('~=4.2', '4.2.20')).toBe('~=4.2.20')
  expect(pySpecFor('^2.6', '2.12.0')).toBe('^2.12.0')
  const up = (name: string, latest: string) =>
    ({ name, ecosystem: 'pypi', spec: '', current: '', latest, bump: 'minor', isDev: false, group: 'bump', conflicts: [] as string[] }) as const
  const raised = rewritePypi(PYPROJECT, [up('requests', '2.34.2'), up('pyyaml', '6.0.3'), up('pytest', '8.4.2')])
  expect(raised).toBe(
    PYPROJECT.replace('"requests>=2.31,<3"', '"requests>=2.34.2,<3"').replace('"PyYAML==6.0.1"', '"PyYAML==6.0.3"').replace('"pytest>=8.0"', '"pytest>=8.4.2"'),
  )
  const poetry = rewritePypi(POETRY, [up('pydantic', '2.12.0'), up('black', '24.10.0')])
  expect(poetry).toBe(POETRY.replace('version = "^2.6"', 'version = "^2.12.0"').replace('black = "^24.2.0"', 'black = "^24.10.0"'))
  expect(rewritePypi('requests==2.31.0\nrequests-oauthlib==1.3.0\n', [up('requests', '2.34.2')])).toBe('requests==2.34.2\nrequests-oauthlib==1.3.0\n')
})

test("PyPI's answer gives the latest release and the GitHub repository", () => {
  const text = JSON.stringify({ info: { version: '6.1.3', project_urls: { Homepage: 'https://www.djangoproject.com/', Source: 'https://github.com/django/django' } } })
  expect(PYPI.latestOf(text)).toBe('6.1.3')
  expect(PYPI.repoUrlOf(text)).toBe('https://github.com/django/django')
  expect(PYPI.latestUrl('Django')).toBe('https://pypi.org/pypi/Django/json')
  expect(importNameOf('PyYAML')).toBe('yaml')
  expect(importNameOf('python-dateutil')).toBe('dateutil')
  expect(importNameOf('my-lib')).toBe('my_lib')
  expect(PYPI.importPattern('beautifulsoup4')).toBe('^[[:space:]]*(import|from)[[:space:]]+bs4([.[:space:],]|$)')
  expect(PYPI.managerOf(['pyproject.toml', 'uv.lock'])).toBe('uv')
  expect(PYPI.installArgv(['pyproject.toml', 'poetry.lock'], [], {})).toEqual([['poetry', 'lock']])
  expect(PYPI.installArgv(['requirements.txt'], [], {})).toEqual([])
})

function python(on: On, latest: Record<string, string>) {
  const files: Record<string, string> = { 'pyproject.toml': PYPROJECT, 'uv.lock': UV_LOCK }
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
  on('http.fetch', (_, e) => {
    const version = latest[decodeURIComponent(e.url.replace('https://pypi.org/pypi/', '').replace(/\/json$/, ''))]
    return {
      value: version
        ? { status: 200, ok: true, headers: {}, text: JSON.stringify({ info: { version } }) }
        : { status: 404, ok: false, headers: {}, text: '{}' },
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
  return { files, ran }
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

test('a uv project lists its packages and the button raises pyproject.toml and runs uv lock', async ($, on) => {
  const { files, ran } = python(on, { requests: '2.34.2', Django: '6.1.3', PyYAML: '6.0.3', mkdocs: '1.5.3', pytest: '8.4.2', ruff: '0.4.10' })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('5 para actualizar de 6 · 1 mayores · 4 triviales')
  expect((await ui.find({ type: 'Text', text: /^Django/ }))?.text).toBe('Django 4.2.11 → 6.1.3')
  expect((await ui.find({ type: 'Text', text: /^ruff/ }))?.text).toBe('ruff 0.4.4 → 0.4.10 · dev')

  await ui.press({ key: 'upgrade-bumps' })
  expect(ran.filter(argv => argv[0] === 'uv')).toEqual([['uv', 'lock']])
  expect(files['pyproject.toml']).toContain('"requests>=2.34.2,<3"')
  expect(files['pyproject.toml']).toContain('"PyYAML==6.0.3"')
  expect(files['pyproject.toml']).toContain('"ruff==0.4.10"')
  // The major is left for the person.
  expect(files['pyproject.toml']).toContain(`"Django[argon2]~=4.2 ; python_version > '3.8'"`)
  await ui.unmount()
})

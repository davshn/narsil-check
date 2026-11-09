import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, parseWorkflows } from '../hooks/actions'
import { released } from './released'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const PATH = '.github/workflows/ci.yml'
const CHECKOUT = '3d3c42e5aac5ba805825da76410c181273ba90b1'
const SETUP_JAVA = 'b843ebf9b913146b38da2eaa7aeddf76074ae1ad'
const SETUP_GRADLE = '8da46b539cd8fe6ab27ca75128919a18d757604c'
const NEW_SETUP_JAVA = '77dd5b2ce225ea11469928ac317850245a74ae78'

// Shaped after mobileTemplate's workflows, plus the forms it does not use.
const WORKFLOW = `name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${CHECKOUT} # v7.0.1
      - uses: actions/setup-java@${SETUP_JAVA} # v6.1.0
        with:
          java-version: 21
      - uses: gradle/actions/setup-gradle@${SETUP_GRADLE} # v6.4.1
      - uses: SonarSource/sonarqube-scan-action@v8.3.0
      - uses: actions/cache@v4
      - uses: o/unversioned@${CHECKOUT}
      - uses: ./.github/actions/local
      - uses: docker://alpine:3.20
      - uses: o/on-a-branch@main
`

const up = (name: string, spec: string, latest: string) => ({ name, ecosystem: 'actions', spec, current: spec, latest, bump: 'minor', isDev: false, group: 'bump', conflicts: [] as string[] }) as const

test('a workflow gives each action with a whole version: a tag, or a commit with its version in a comment', () => {
  expect(parseWorkflows({ [PATH]: WORKFLOW })).toEqual([
    { name: 'actions/checkout', spec: '7.0.1', isDev: false, installed: '7.0.1', source: `file:${PATH}` },
    { name: 'actions/setup-java', spec: '6.1.0', isDev: false, installed: '6.1.0', source: `file:${PATH}` },
    { name: 'gradle/actions', spec: '6.4.1', isDev: false, installed: '6.4.1', source: `file:${PATH}` },
    { name: 'SonarSource/sonarqube-scan-action', spec: '8.3.0', isDev: false, installed: '8.3.0', source: `file:${PATH}` },
  ])
})

test('the latest release is the highest whole version tag, never a moving v8 or v8.4', () => {
  expect(ACTIONS.latestOf(['a\trefs/tags/v8.3.0', 'b\trefs/tags/v8.4', 'c\trefs/tags/v8.4.1', 'd\trefs/tags/v9', 'e\trefs/tags/v9.0.0-beta.1'].join('\n'))).toBe('8.4.1')
})

test('a new tag reads as the commit it points at, through an annotated tag too', () => {
  const u = up('actions/setup-java', '6.1.0', '6.2.0')
  expect(ACTIONS.pinCommand?.(u)).toEqual(['git', 'ls-remote', '--tags', 'https://github.com/actions/setup-java', 'refs/tags/v6.2.0', 'refs/tags/v6.2.0^{}', 'refs/tags/6.2.0', 'refs/tags/6.2.0^{}'])
  const tag = 'd4ca2e3147b409459955613c152220f4db848ee1'
  expect(ACTIONS.pinOf?.(`${NEW_SETUP_JAVA}\trefs/tags/v6.2.0\n`, u)).toBe(NEW_SETUP_JAVA)
  expect(ACTIONS.pinOf?.(`${tag}\trefs/tags/v6.2.0\n${NEW_SETUP_JAVA}\trefs/tags/v6.2.0^{}\n`, u)).toBe(NEW_SETUP_JAVA)
  expect(ACTIONS.pinOf?.('', u)).toBeUndefined()
})

test('raising an action changes its commit and comment, or its tag, and every other byte stays', () => {
  const crlf = WORKFLOW.replace(/\n/g, '\r\n')
  const out = ACTIONS.rewrite?.({ [PATH]: crlf }, [up('actions/setup-java', '6.1.0', '6.2.0'), up('SonarSource/sonarqube-scan-action', '8.3.0', '8.4.1')], { 'actions/setup-java': NEW_SETUP_JAVA, 'SonarSource/sonarqube-scan-action': CHECKOUT })
  expect(out?.[PATH]).toBe(crlf.replace(`setup-java@${SETUP_JAVA} # v6.1.0`, `setup-java@${NEW_SETUP_JAVA} # v6.2.0`).replace('scan-action@v8.3.0', 'scan-action@v8.4.1'))
})

test('a sub-action moves with its repository, and another version of the same action is left for the next scan', () => {
  const text = `steps:\n  - uses: gradle/actions/setup-gradle@${SETUP_GRADLE} # v6.4.1\n  - uses: gradle/actions/dependency-submission@${CHECKOUT} # v6.0.0\n`
  const out = ACTIONS.rewrite?.({ [PATH]: text }, [up('gradle/actions', '6.4.1', '6.5.0')], { 'gradle/actions': NEW_SETUP_JAVA })
  expect(out?.[PATH]).toBe(`steps:\n  - uses: gradle/actions/setup-gradle@${NEW_SETUP_JAVA} # v6.5.0\n  - uses: gradle/actions/dependency-submission@${CHECKOUT} # v6.0.0\n`)
})

function workflows(on: On, tags: Record<string, string[]>, commits: Record<string, string>) {
  const files: Record<string, string> = { [PATH]: WORKFLOW }
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
  on('http.fetch', (_, e) => released(e.url) ?? { value: { status: 404, ok: false, headers: {}, text: '' } })
  on('process.run', (_, e) => {
    const done = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[1] === 'ls-files') return done(e.argv.some(arg => arg.includes('workflows')) ? `${PATH}\n` : '')
    if (e.argv[1] === 'ls-remote' && e.argv[3] === '--refs') return done((tags[e.argv[4] as string] ?? []).map((t, i) => `${i}\trefs/tags/${t}`).join('\n'))
    if (e.argv[1] === 'ls-remote') {
      const commit = commits[e.argv[3] as string]
      return commit ? done(`${commit}\t${e.argv[4]}\n`) : done('')
    }
    return done('', e.argv[0] === 'git' ? 1 : 0)
  })
  return { files }
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

const github = (repo: string) => `https://github.com/${repo}`
const TAGS = {
  [github('actions/checkout')]: ['v7.0.1', 'v7'],
  [github('actions/setup-java')]: ['v6.1.0', 'v6.2.0', 'v6'],
  [github('gradle/actions')]: ['v6.4.1', 'v7.0.0'],
  [github('SonarSource/sonarqube-scan-action')]: ['v8.3.0', 'v8.4', 'v8.4.1'],
}

test('the button raises a commit-pinned action to its new commit and a tag-pinned one to its new tag, leaving a major', async ($, on) => {
  const { files } = workflows(on, TAGS, { [github('actions/setup-java')]: NEW_SETUP_JAVA, [github('SonarSource/sonarqube-scan-action')]: CHECKOUT })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('3 para actualizar de 4 · 1 mayores · 2 triviales')
  expect((await ui.find({ type: 'Button', text: /^actions\/setup-java/ }))?.text).toBe('actions/setup-java 6.1.0 → 6.2.0')

  await ui.press({ key: 'upgrade-bumps' })
  expect(files[PATH]).toContain(`actions/setup-java@${NEW_SETUP_JAVA} # v6.2.0`)
  expect(files[PATH]).toContain('SonarSource/sonarqube-scan-action@v8.4.1')
  expect(files[PATH]).toContain(`gradle/actions/setup-gradle@${SETUP_GRADLE} # v6.4.1`)
  expect((await ui.find({ type: 'Text', text: /^Actualicé/ }))?.text).toBe('Actualicé 2 librerías. Ejecuta los tests antes de hacer commit.')
  await ui.unmount()
})

test('a new tag whose commit cannot be read leaves every workflow as it was and says which', async ($, on) => {
  const { files } = workflows(on, TAGS, { [github('SonarSource/sonarqube-scan-action')]: CHECKOUT })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'upgrade-bumps' })

  expect(files[PATH]).toBe(WORKFLOW)
  expect((await ui.find({ type: 'Text', text: /sin actualizar/ }))?.text).toBe('GitHub Actions quedó sin actualizar (2 librerías): no pude leer el commit de actions/setup-java 6.2.0 y dejé sus archivos como estaban.')
  await ui.unmount()
})

import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { holdNote } from '../hooks/adapter'
import { isKotlin, kotlinConflicts, parseMaven } from '../hooks/maven'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'upgrade-mod',
  component: 'Pane',
  requestId: 'upgrades',
  props: { title: 'Actualizaciones', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Shaped after mobileTemplate: Kotlin shared by its plugins, SKIE in the
// catalog, mokkery a version only build-logic reads, coroutines (kotlinx)
// going up on its own.
const CATALOG = `[versions]
kotlin = "2.4.20"
coroutines = "1.11.0"
skie = "0.10.16"
mokkery = "3.6.0"

[libraries]
kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }

[plugins]
kotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
skie = { id = "co.touchlab.skie", version.ref = "skie" }
`

const up = (name: string, spec: string, latest: string) =>
  ({ name, ecosystem: 'maven', spec, current: spec, latest, bump: 'patch', isDev: false, group: 'bump', conflicts: [] as string[] }) as const

test('a comment with a hold word on the version line, or the line above, keeps it', () => {
  const toml = ['[versions]', '# Fijar 2.4.20 hasta confirmar soporte de SKIE para 2.4.21', 'kotlin = "2.4.20"', 'ktor = "3.6.1" # pinned: 3.7 breaks auth', 'koin = "4.2.2" # the DI library'].join('\n')
  expect(holdNote({ 'gradle/libs.versions.toml': toml }, ['kotlin'], '2.4.20')).toBe('Fijar 2.4.20 hasta confirmar soporte de SKIE para 2.4.21')
  expect(holdNote({ 'gradle/libs.versions.toml': toml }, ['ktor'], '3.6.1')).toBe('pinned: 3.7 breaks auth')
  // A comment with no hold word is only a comment.
  expect(holdNote({ 'gradle/libs.versions.toml': toml }, ['koin'], '4.2.2')).toBeUndefined()
  // Another library's line with the same version is not this one's.
  expect(holdNote({ 'a.toml': 'other = "2.4.20" # keep' }, ['kotlin'], '2.4.20')).toBeUndefined()
  // A Gradle or a Gemfile comment counts the same way.
  expect(holdNote({ 'build.gradle.kts': 'implementation("io.mockk:mockk:1.13.10") // do not upgrade: needs JDK 21' }, ['io.mockk:mockk'], '1.13.10')).toBe('do not upgrade: needs JDK 21')
  expect(holdNote({ Gemfile: 'gem "rails", "~> 7.1.3" # hold until the 8.0 migration' }, ['rails'], '~> 7.1.3')).toBe('hold until the 8.0 migration')
})

test('Kotlin is Kotlin and its plugins, never kotlinx', () => {
  expect(isKotlin('org.jetbrains.kotlin:kotlin-stdlib')).toBe(true)
  expect(isKotlin('org.jetbrains.kotlin.multiplatform:org.jetbrains.kotlin.multiplatform.gradle.plugin')).toBe(true)
  expect(isKotlin('org.jetbrains.kotlinx:kotlinx-coroutines-core')).toBe(false)
})

test('Kotlin cannot go up past the compiler plugins the project declares', () => {
  const files = { 'gradle/libs.versions.toml': CATALOG }
  const deps = parseMaven(files)
  const kotlin = up('org.jetbrains.kotlin.multiplatform:org.jetbrains.kotlin.multiplatform.gradle.plugin', '2.4.20', '2.4.21')
  expect(kotlinConflicts(kotlin, deps, files)).toEqual([
    'SKIE 0.10.16 es un plugin del compilador de Kotlin: confirma que soporta Kotlin 2.4.21',
    // Found by its catalog key: no coordinate uses it.
    'Mokkery 3.6.0 es un plugin del compilador de Kotlin: confirma que soporta Kotlin 2.4.21',
  ])
  // Coroutines go up on their own.
  expect(kotlinConflicts(up('org.jetbrains.kotlinx:kotlinx-coroutines-core', '1.11.0', '1.11.1'), deps, files)).toEqual([])
})

test("KSP's version names the Kotlin it is built for, so it is checked exactly", () => {
  const build = 'plugins {\n    id("com.google.devtools.ksp") version "2.4.20-1.0.30"\n}\n'
  const files = { 'app/build.gradle.kts': build }
  const deps = parseMaven(files)
  const kotlin = up('org.jetbrains.kotlin:kotlin-stdlib', '2.4.20', '2.4.21')
  expect(kotlinConflicts(kotlin, deps, files)).toEqual(['KSP 2.4.20-1.0.30 está hecho para Kotlin 2.4.20: hace falta un KSP para 2.4.21'])
  // Built for the new Kotlin: nothing blocks.
  expect(kotlinConflicts(up('org.jetbrains.kotlin:kotlin-stdlib', '2.4.20', '2.4.20'), deps, files)).toEqual([])
  // A KSP2 version with no Kotlin in it works with any.
  const ksp2 = { 'app/build.gradle.kts': 'plugins {\n    id("com.google.devtools.ksp") version "2.3.0"\n}\n' }
  expect(kotlinConflicts(kotlin, parseMaven(ksp2), ksp2)).toEqual([])
})

function gradleProject(on: On, catalog: string, metadata: Record<string, string[]>) {
  const files: Record<string, string> = { 'gradle/libs.versions.toml': catalog }
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
    const versions = Object.entries(metadata).find(([path]) => e.url.includes(path))?.[1]
    return {
      value: versions
        ? { status: 200, ok: true, headers: {}, text: `<metadata><versions>${versions.map(v => `<version>${v}</version>`).join('')}</versions></metadata>` }
        : { status: 404, ok: false, headers: {}, text: '' },
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
  on('process.run', (_, e) => ({
    value: { exitCode: e.argv[1] === 'ls-files' ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  return files
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

test("in mobileTemplate's shape Kotlin's patch is blocked by SKIE and the button leaves it out", async ($, on) => {
  const files = gradleProject(on, CATALOG, {
    'org/jetbrains/kotlinx/kotlinx-coroutines-core': ['1.11.0', '1.11.1'],
    'org/jetbrains/kotlin/multiplatform': ['2.4.20', '2.4.21'],
    'co/touchlab/skie': ['0.10.16'],
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Bloqueada/ }))?.text).toBe('Bloqueada (1)')
  expect((await ui.find({ type: 'Text', text: /SKIE/ }))?.text).toBe(
    '  SKIE 0.10.16 es un plugin del compilador de Kotlin: confirma que soporta Kotlin 2.4.21 · Mokkery 3.6.0 es un plugin del compilador de Kotlin: confirma que soporta Kotlin 2.4.21',
  )

  await ui.press({ key: 'upgrade-bumps' })
  expect(files['gradle/libs.versions.toml']).toContain('coroutines = "1.11.1"')
  expect(files['gradle/libs.versions.toml']).toContain('kotlin = "2.4.20"')
  await ui.unmount()
})

test('a version kept by a comment is blocked with that comment', async ($, on) => {
  const catalog = CATALOG.replace('coroutines = "1.11.0"', 'coroutines = "1.11.0" # keep: 1.11.1 breaks the iOS test runner')
  gradleProject(on, catalog, { 'org/jetbrains/kotlinx/kotlinx-coroutines-core': ['1.11.0', '1.11.1'] })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Fijada/ }))?.text).toBe('  Fijada a propósito: «keep: 1.11.1 breaks the iOS test runner»')
  expect(await ui.find({ type: 'Button', text: /Actualizar/ })).toBeUndefined()
  await ui.unmount()
})

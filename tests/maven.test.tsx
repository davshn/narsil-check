import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { MAVEN, isStable, latestStable, metadataUrl, parseCatalog, parseGradle, parseMaven, parsePom, pluginCoordinate, pomUrl, repositoryOf, rewriteMaven } from '../hooks/maven'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Shaped after mobileTemplate's catalog: shared refs, plugins, an inline
// version, a strict version and a version nothing uses.
const CATALOG = `[versions]
kotlin = "2.4.20"
agp = "9.5.0"
ktor = "3.6.1"
guava = { strictly = "33.2.1-jre" }
android-compileSdk = "37"

[libraries]
ktor-client-core = { module = "io.ktor:ktor-client-core", version.ref = "ktor" }
ktor-client-auth = { module = "io.ktor:ktor-client-auth", version.ref = "ktor" }
okhttp = { group = "com.squareup.okhttp3", name = "okhttp", version = "4.12.0" }
junit = "junit:junit:4.13.2"
guava = { module = "com.google.guava:guava", version.ref = "guava" }
compose-bom = { module = "androidx.compose:compose-bom", version = "2026.09.00" }
compose-ui = { module = "androidx.compose.ui:ui" }

[plugins]
kotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "kotlin" }
android-application = { id = "com.android.application", version.ref = "agp" }
detekt = "io.gitlab.arturbosch.detekt:1.23.8"
`

const BUILD = `plugins {
    id("com.google.devtools.ksp") version "2.4.20-1.0.30"
    alias(libs.plugins.kotlin.multiplatform)
}

dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    testImplementation("io.mockk:mockk:1.13.10")
    implementation(libs.ktor.client.core)
    implementation("org.example:lib:$libVersion")
}
`

const POM = `<project>
  <properties>
    <spring.version>6.1.5</spring.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>\${spring.version}</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.managed</groupId>
      <artifactId>by-parent</artifactId>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
    </plugins>
  </build>
</project>
`

test('a catalog version several libraries and plugins share is one row', () => {
  expect(parseCatalog(CATALOG)).toEqual([
    { name: 'com.squareup.okhttp3:okhttp', spec: '4.12.0', isDev: false, installed: '4.12.0', display: undefined, source: 'catalog:libraries.okhttp' },
    { name: 'junit:junit', spec: '4.13.2', isDev: false, installed: '4.13.2', display: undefined, source: 'catalog:libraries.junit' },
    { name: 'androidx.compose:compose-bom', spec: '2026.09.00', isDev: false, installed: '2026.09.00', display: undefined, source: 'catalog:libraries.compose-bom' },
    {
      name: 'io.gitlab.arturbosch.detekt:io.gitlab.arturbosch.detekt.gradle.plugin',
      spec: '1.23.8',
      isDev: false,
      installed: '1.23.8',
      display: 'io.gitlab.arturbosch.detekt',
      source: 'catalog:plugins.detekt',
    },
    { name: 'io.ktor:ktor-client-core', spec: '3.6.1', isDev: false, installed: '3.6.1', display: 'ktor (2)', source: 'catalog:versions.ktor' },
    { name: 'com.google.guava:guava', spec: '33.2.1-jre', isDev: false, installed: '33.2.1-jre', display: 'guava', source: 'catalog:versions.guava' },
    {
      name: 'org.jetbrains.kotlin.multiplatform:org.jetbrains.kotlin.multiplatform.gradle.plugin',
      spec: '2.4.20',
      isDev: false,
      installed: '2.4.20',
      display: 'kotlin',
      source: 'catalog:versions.kotlin',
    },
    {
      name: 'com.android.application:com.android.application.gradle.plugin',
      spec: '9.5.0',
      isDev: false,
      installed: '9.5.0',
      display: 'agp',
      source: 'catalog:versions.agp',
    },
  ])
})

test('a build file gives its written coordinates and plugin versions, not variables', () => {
  expect(parseGradle(BUILD, 'app/build.gradle.kts')).toEqual([
    { name: 'com.squareup.retrofit2:retrofit', spec: '2.11.0', isDev: false, installed: '2.11.0', source: 'file:app/build.gradle.kts' },
    { name: 'io.mockk:mockk', spec: '1.13.10', isDev: true, installed: '1.13.10', source: 'file:app/build.gradle.kts' },
    {
      name: 'com.google.devtools.ksp:com.google.devtools.ksp.gradle.plugin',
      spec: '2.4.20-1.0.30',
      isDev: false,
      installed: '2.4.20-1.0.30',
      display: 'com.google.devtools.ksp',
      source: 'file:app/build.gradle.kts',
    },
  ])
})

test('pom.xml gives dependencies and plugins with their property versions, not managed ones', () => {
  expect(parsePom(POM, 'pom.xml')).toEqual([
    { name: 'org.springframework:spring-core', spec: '6.1.5', isDev: false, installed: '6.1.5', source: 'pom-prop:pom.xml:spring.version' },
    { name: 'org.junit.jupiter:junit-jupiter', spec: '5.10.2', isDev: true, installed: '5.10.2', source: 'pom:pom.xml' },
    { name: 'org.apache.maven.plugins:maven-surefire-plugin', spec: '3.2.5', isDev: false, installed: '3.2.5', source: 'pom:pom.xml' },
  ])
  expect(parseMaven({ 'gradle/libs.versions.toml': CATALOG, 'app/build.gradle.kts': BUILD, 'server/pom.xml': POM }).length).toBe(14)
})

test('only stable releases count, the highest of the list', () => {
  const xml = `<metadata><versioning><release>2.12.0-alpha05</release><versions>
    <version>2.10.0</version><version>2.11.0</version><version>2.11.1</version>
    <version>2.12.0-alpha05</version><version>3.0.0-rc01</version><version>3.0.0-M1</version>
    <version>2.11.2-SNAPSHOT</version></versions></versioning></metadata>`
  expect(latestStable(xml)).toBe('2.11.1')
  expect(isStable('33.2.1-jre')).toBe(true)
  expect(isStable('2.5.0-Beta2')).toBe(false)
  expect(isStable('9.6.0-alpha02')).toBe(false)
  expect(isStable('1.0.0-dev-1234')).toBe(false)
})

test('each coordinate is asked of the repository that serves it', () => {
  expect(repositoryOf('androidx.lifecycle', 'lifecycle-viewmodel')).toBe('https://dl.google.com/android/maven2')
  expect(repositoryOf('com.android.application', 'com.android.application.gradle.plugin')).toBe('https://dl.google.com/android/maven2')
  expect(repositoryOf('org.jetbrains.kotlin.multiplatform', 'org.jetbrains.kotlin.multiplatform.gradle.plugin')).toBe('https://plugins.gradle.org/m2')
  expect(repositoryOf('io.ktor', 'ktor-client-core')).toBe('https://repo1.maven.org/maven2')
  expect(metadataUrl('io.ktor:ktor-client-core')).toBe('https://repo1.maven.org/maven2/io/ktor/ktor-client-core/maven-metadata.xml')
  expect(pomUrl('io.ktor:ktor-client-core', '3.6.1')).toBe('https://repo1.maven.org/maven2/io/ktor/ktor-client-core/3.6.1/ktor-client-core-3.6.1.pom')
  expect(MAVEN.alternateUrl?.('org.jlleitschuh.gradle:ktlint-gradle')).toBe('https://plugins.gradle.org/m2/org/jlleitschuh/gradle/ktlint-gradle/maven-metadata.xml')
  expect(pluginCoordinate('co.touchlab.skie')).toBe('co.touchlab.skie:co.touchlab.skie.gradle.plugin')
  expect(MAVEN.repoUrlOf('<project><scm><url>https://github.com/ktorio/ktor.git</url></scm></project>')).toBe('https://github.com/ktorio/ktor.git')
  expect(MAVEN.importPattern('io.ktor:ktor-client-core')).toBe('^[[:space:]]*import[[:space:]]+(static[[:space:]]+)?io\\.ktor\\.')
})

test('raising versions where each is written leaves every other byte as it was', () => {
  const up = (name: string, spec: string, latest: string, source: string) =>
    ({ name, ecosystem: 'maven', spec, current: spec, latest, bump: 'minor', isDev: false, group: 'bump', conflicts: [] as string[], source }) as const
  const out = rewriteMaven({ 'gradle/libs.versions.toml': CATALOG, 'app/build.gradle.kts': BUILD, 'pom.xml': POM }, [
    up('io.ktor:ktor-client-core', '3.6.1', '3.7.0', 'catalog:versions.ktor'),
    up('com.google.guava:guava', '33.2.1-jre', '33.4.0-jre', 'catalog:versions.guava'),
    up('com.squareup.okhttp3:okhttp', '4.12.0', '4.12.1', 'catalog:libraries.okhttp'),
    up('junit:junit', '4.13.2', '4.13.3', 'catalog:libraries.junit'),
    up('io.mockk:mockk', '1.13.10', '1.13.17', 'file:app/build.gradle.kts'),
    up('com.google.devtools.ksp:com.google.devtools.ksp.gradle.plugin', '2.4.20-1.0.30', '2.4.21-1.0.31', 'file:app/build.gradle.kts'),
    up('org.springframework:spring-core', '6.1.5', '6.1.14', 'pom-prop:pom.xml:spring.version'),
    up('org.junit.jupiter:junit-jupiter', '5.10.2', '5.11.4', 'pom:pom.xml'),
  ])
  expect(out['gradle/libs.versions.toml']).toBe(
    CATALOG.replace('ktor = "3.6.1"', 'ktor = "3.7.0"')
      .replace('guava = { strictly = "33.2.1-jre" }', 'guava = { strictly = "33.4.0-jre" }')
      .replace('version = "4.12.0"', 'version = "4.12.1"')
      .replace('"junit:junit:4.13.2"', '"junit:junit:4.13.3"'),
  )
  expect(out['app/build.gradle.kts']).toBe(
    BUILD.replace('io.mockk:mockk:1.13.10', 'io.mockk:mockk:1.13.17').replace('version "2.4.20-1.0.30"', 'version "2.4.21-1.0.31"'),
  )
  expect(out['pom.xml']).toBe(POM.replace('<spring.version>6.1.5</spring.version>', '<spring.version>6.1.14</spring.version>').replace('<version>5.10.2</version>', '<version>5.11.4</version>'))
})

function gradleProject(on: On, metadata: Record<string, string[]>) {
  const files: Record<string, string> = { 'gradle/libs.versions.toml': CATALOG, 'app/build.gradle.kts': BUILD }
  const store = new Map<string, unknown>()
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
  on('fs.write', (_, e) => {
    files[keyOf(e.path) ?? e.path] = e.text
    return { value: undefined }
  })
  on('http.fetch', (_, e) => {
    const versions = metadata[e.url]
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
  const ran: string[][] = []
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const ls = e.argv[1] === 'ls-files'
    return { value: { exitCode: ls ? 0 : e.argv[0] === 'git' ? 1 : 0, stdout: ls ? 'app/build.gradle.kts\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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

test('a Gradle project shows a shared version as one row and the button raises the catalog', async ($, on) => {
  const central = 'https://repo1.maven.org/maven2'
  const { files, ran } = gradleProject(on, {
    [`${central}/io/ktor/ktor-client-core/maven-metadata.xml`]: ['3.6.1', '3.7.0', '4.0.0-beta1'],
    [`${central}/com/squareup/retrofit2/retrofit/maven-metadata.xml`]: ['2.11.0', '3.0.0'],
    [`${central}/io/mockk/mockk/maven-metadata.xml`]: ['1.13.10', '1.13.17'],
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('3 para actualizar de 11 · 1 mayores · 2 triviales')
  expect((await ui.find({ type: 'Text', text: /^ktor/ }))?.text).toBe('ktor (2) 3.6.1 → 3.7.0')
  expect((await ui.find({ type: 'Text', text: /^io.mockk/ }))?.text).toBe('io.mockk:mockk 1.13.10 → 1.13.17 · dev')

  await ui.press({ key: 'upgrade-bumps' })
  expect(files['gradle/libs.versions.toml']).toContain('ktor = "3.7.0"')
  expect(files['app/build.gradle.kts']).toContain('io.mockk:mockk:1.13.17')
  // The major is left for the person, and Gradle fetches on the next build.
  expect(files['app/build.gradle.kts']).toContain('com.squareup.retrofit2:retrofit:2.11.0')
  expect(ran.filter(argv => argv[0] !== 'git')).toEqual([])
  await ui.unmount()
})

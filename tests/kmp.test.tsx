import { expect, test } from 'claude-code/testing'

import type { Upgrade } from '../types'
import type { Dep } from '../hooks/adapter'
import { WRAPPER, gradleVersionOf, kmpConflicts } from '../hooks/kmp'
import { MAVEN, pluginCoordinate } from '../hooks/maven'

const wrapper = (gradle: string) => ({ [WRAPPER]: `distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-${gradle}-bin.zip\n` })
const dep = (name: string, version: string): Dep => ({ name, spec: version, isDev: false, installed: version })
const up = (name: string, current: string, latest: string): Upgrade => ({ name, ecosystem: 'maven', spec: current, current, latest, bump: 'minor', isDev: false, group: 'bump', conflicts: [] })

const AGP_APP = pluginCoordinate('com.android.application')
const AGP_LIBRARY = pluginCoordinate('com.android.library')
const KMP = pluginCoordinate('org.jetbrains.kotlin.multiplatform')
const COMPOSE = pluginCoordinate('org.jetbrains.compose')
const KSP = pluginCoordinate('com.google.devtools.ksp')

test("the wrapper's distributionUrl gives the Gradle version", () => {
  expect(gradleVersionOf(wrapper('8.11.1'))).toBe('8.11.1')
  expect(gradleVersionOf({ [WRAPPER]: 'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.1-all.zip' })).toBe('9.1')
  expect(gradleVersionOf({})).toBeUndefined()
})

test('the Android Gradle Plugin cannot go past what the Gradle wrapper runs', () => {
  const deps = [dep(AGP_APP, '8.10.1'), dep(KMP, '2.2.20')]
  // AGP 8.13 needs Gradle 8.13.
  expect(kmpConflicts(up(AGP_APP, '8.10.1', '8.13.0'), deps, wrapper('8.11.1'))).toEqual(['AGP 8.13.0 necesita Gradle 8.13 o más; el wrapper usa 8.11.1'])
  expect(kmpConflicts(up(AGP_APP, '8.10.1', '8.13.0'), deps, wrapper('8.14.3'))).toEqual([])
  // No wrapper: it cannot be confirmed, so it waits.
  expect(kmpConflicts(up(AGP_APP, '8.10.1', '8.13.0'), deps, {})).toEqual([`AGP 8.13.0 necesita Gradle 8.13 o más y no encontré ${WRAPPER} para confirmarlo`])
  // Newer than Google's table: confirm by hand.
  expect(kmpConflicts(up(AGP_APP, '9.5.0', '9.6.0'), deps, wrapper('9.7.0'))).toEqual(['AGP 9.6.0 es más nuevo que la tabla de Google que conozco (hasta 9.5): confirma qué Gradle necesita'])
  // The coordinate form, as a buildscript classpath writes it.
  expect(kmpConflicts(up('com.android.tools.build:gradle', '8.10.1', '8.13.0'), deps, wrapper('8.11.1'))).toEqual(['AGP 8.13.0 necesita Gradle 8.13 o más; el wrapper usa 8.11.1'])
})

test('AGP 9 refuses KMP modules on com.android.library and kapt', () => {
  const deps = [dep(AGP_LIBRARY, '8.13.0'), dep(KMP, '2.3.0'), dep(pluginCoordinate('org.jetbrains.kotlin.kapt'), '2.3.0')]
  expect(kmpConflicts(up(AGP_LIBRARY, '8.13.0', '9.0.0'), deps, wrapper('9.1.0'))).toEqual([
    'AGP 9.0.0 no permite org.jetbrains.kotlin.multiplatform junto a com.android.library o com.android.application: los módulos KMP pasan a com.android.kotlin.multiplatform.library',
    'AGP 9.0.0 trae Kotlin integrado, que no funciona con kapt: hay que pasar a KSP o usar com.android.legacy-kapt',
  ])
  // Already on the KMP library plugin, no kapt: nothing to say.
  const migrated = [dep(pluginCoordinate('com.android.kotlin.multiplatform.library'), '8.13.0'), dep(KMP, '2.3.0')]
  expect(kmpConflicts(up(pluginCoordinate('com.android.kotlin.multiplatform.library'), '8.13.0', '9.0.0'), migrated, wrapper('9.1.0'))).toEqual([])
})

test('Kotlin cannot go past the AGP and Gradle its Gradle plugin supports at least', () => {
  const deps = [dep(AGP_APP, '8.2.0'), dep(KMP, '2.3.20')]
  expect(kmpConflicts(up(KMP, '2.3.20', '2.4.0'), deps, wrapper('8.14'))).toEqual(['Kotlin 2.4.0 necesita AGP 8.5.2 o más; el proyecto usa 8.2.0'])
  expect(kmpConflicts(up(KMP, '2.3.20', '2.4.0'), [dep(AGP_APP, '8.13.0'), dep(KMP, '2.3.20')], wrapper('7.5'))).toEqual(['Kotlin 2.4.0 necesita Gradle 7.6.3 o más; el wrapper usa 7.5'])
  expect(kmpConflicts(up(KMP, '2.3.20', '2.4.0'), [dep(AGP_APP, '8.13.0'), dep(KMP, '2.3.20')], wrapper('8.14'))).toEqual([])
})

test('Compose Multiplatform cannot go past the Kotlin and AGP it needs', () => {
  const deps = [dep(AGP_APP, '8.0.2'), dep(KMP, '2.1.20'), dep(COMPOSE, '1.9.0')]
  expect(kmpConflicts(up(COMPOSE, '1.9.0', '1.10.0'), deps, wrapper('8.14'))).toEqual([
    'Compose Multiplatform 1.10.0 necesita Kotlin 2.2.0 o más; el proyecto usa 2.1.20',
    'Compose Multiplatform 1.10.0 necesita AGP 8.1.0 o más; el proyecto usa 8.0.2',
  ])
  // A Compose library goes with the plugin.
  expect(kmpConflicts(up('org.jetbrains.compose.runtime:runtime', '1.9.0', '1.11.1'), [dep(AGP_APP, '8.13.0'), dep(KMP, '2.2.20')], wrapper('8.14'))).toEqual(['Compose Multiplatform 1.11.1 necesita Kotlin 2.3.0 o más; el proyecto usa 2.2.20'])
  expect(kmpConflicts(up(COMPOSE, '1.12.2', '1.13.0'), deps, wrapper('8.14'))).toEqual(['Compose Multiplatform 1.13.0 es más nuevo que lo que sé de sus requisitos (hasta 1.12): confirma qué Kotlin y AGP necesita'])
})

test('KSP from 2.3.12 needs AGP 8.12', () => {
  const deps = [dep(AGP_APP, '8.10.1'), dep(KMP, '2.3.20'), dep(KSP, '2.3.10')]
  expect(kmpConflicts(up(KSP, '2.3.10', '2.3.13'), deps, wrapper('8.14'))).toEqual(['KSP 2.3.13 necesita AGP 8.12.0 o más; el proyecto usa 8.10.1'])
  expect(kmpConflicts(up(KSP, '2.3.10', '2.3.11'), deps, wrapper('8.14'))).toEqual([])
})

test("the Maven adapter reads the wrapper as context, never commits it, and asks these rules", () => {
  expect(MAVEN.contextFiles).toContain(WRAPPER)
  expect(MAVEN.lockfiles).not.toContain(WRAPPER)
  const deps = [dep(AGP_APP, '8.10.1'), dep(KMP, '2.2.20')]
  expect(MAVEN.conflictsOf?.(up(AGP_APP, '8.10.1', '8.13.0'), deps, wrapper('8.11.1'))).toEqual(['AGP 8.13.0 necesita Gradle 8.13 o más; el wrapper usa 8.11.1'])
})

test('artifacts under org.jetbrains.compose on their own version line are not Compose Multiplatform', () => {
  const deps = [dep(AGP_APP, '8.13.0'), dep(KMP, '2.3.20')]
  expect(kmpConflicts(up(pluginCoordinate('org.jetbrains.compose.hot-reload'), '1.0.0', '1.2.0'), deps, wrapper('8.14'))).toEqual([])
  expect(kmpConflicts(up('org.jetbrains.compose.material3.adaptive:adaptive', '1.1.2', '1.2.0'), deps, wrapper('8.14'))).toEqual([])
  // The plugin and the main line's libraries still are.
  expect(kmpConflicts(up('org.jetbrains.compose.ui:ui', '1.9.0', '1.13.0'), deps, wrapper('8.14'))).toEqual(['Compose Multiplatform 1.13.0 es más nuevo que lo que sé de sus requisitos (hasta 1.12): confirma qué Kotlin y AGP necesita'])
})

test('a wrapper under android/, as a React Native project keeps it, gives the Gradle version too', () => {
  const files = { [`android/${WRAPPER}`]: 'distributionUrl=https\://services.gradle.org/distributions/gradle-8.11.1-bin.zip' }
  expect(gradleVersionOf(files)).toBe('8.11.1')
  expect(MAVEN.contextFiles).toContain(`android/${WRAPPER}`)
  expect(kmpConflicts(up('com.android.tools.build:gradle', '8.10.1', '8.13.0'), [dep('com.android.tools.build:gradle', '8.10.1')], files)).toEqual(['AGP 8.13.0 necesita Gradle 8.13 o más; el wrapper usa 8.11.1'])
})

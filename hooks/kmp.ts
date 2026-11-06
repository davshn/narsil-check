// What a Kotlin Multiplatform or Android build breaks when one of its tools
// goes up alone: the Android Gradle Plugin needs a Gradle, Kotlin needs an
// AGP and a Gradle, Compose Multiplatform needs a Kotlin. Pure: the tables
// come from the tools' own documentation, quoted below.

import type { Upgrade } from '../types'
import type { Dep, Files } from './adapter'
import { compare, parseVersion } from './semver'

export const WRAPPER = 'gradle/wrapper/gradle-wrapper.properties'

// AGP minor -> the minimum Gradle it runs on.
// https://developer.android.com/build/releases/about-agp ("Update Gradle"),
// as of AGP 9.5.0.
const AGP_GRADLE: Record<string, string> = {
  '9.5': '9.6.0', '9.4': '9.6.0', '9.3': '9.5.0', '9.2': '9.4.1', '9.1': '9.3.1', '9.0': '9.1.0',
  '8.13': '8.13', '8.12': '8.13', '8.11': '8.13', '8.10': '8.11.1', '8.9': '8.11.1', '8.8': '8.10.2',
  '8.7': '8.9', '8.6': '8.7', '8.5': '8.7', '8.4': '8.6', '8.3': '8.4', '8.2': '8.2', '8.1': '8.0', '8.0': '8.0',
  '7.4': '7.5', '7.3': '7.4', '7.2': '7.3.3', '7.1': '7.2', '7.0': '7.0',
}

// Kotlin (from this version on) -> the minimum AGP and Gradle its Gradle
// plugin supports. The maximums are what is fully supported, not a failure,
// so they are not checked.
// https://kotlinlang.org/docs/gradle-configure-project.html, as of 2.4.21.
const KOTLIN_MINIMUMS: { from: string; agp: string; gradle: string }[] = [
  { from: '2.4.0', agp: '8.5.2', gradle: '7.6.3' },
  { from: '2.3.0', agp: '8.2.2', gradle: '7.6.3' },
  { from: '2.1.0', agp: '7.3.1', gradle: '7.6.3' },
  { from: '2.0.0', agp: '7.1.3', gradle: '6.8.3' },
]

// Compose Multiplatform minor -> the minimum Kotlin, the strictest platform's
// (iOS and web), and the minimum AGP where one is stated.
// https://github.com/JetBrains/compose-multiplatform/blob/master/CHANGELOG.md
// (Migration Notes) and kotlinlang.org's compatibility page. 1.12 states no
// new minimum: it keeps 1.11's.
const COMPOSE_MINIMUMS: Record<string, { kotlin?: string; agp?: string }> = {
  '1.6': { kotlin: '2.0.0' },
  '1.7': { kotlin: '2.0.0', agp: '8.1.0' },
  '1.8': { kotlin: '2.1.0', agp: '8.1.0' },
  '1.9': { kotlin: '2.1.0', agp: '8.1.0' },
  '1.10': { kotlin: '2.2.0', agp: '8.1.0' },
  '1.11': { kotlin: '2.3.0', agp: '8.1.0' },
  '1.12': { kotlin: '2.3.0', agp: '8.1.0' },
}

// KSP from 2.3.12 needs AGP 8.12.0. https://github.com/google/ksp/releases
const KSP_AGP = { from: '2.3.12', agp: '8.12.0' }

const isAgp = (name: string) => /^com\.android\.tools\.build:gradle$/.test(name) || /^com\.android\.[\w.-]+:com\.android\.[\w.-]+\.gradle\.plugin$/.test(name)
const isKotlinTool = (name: string) => /^org\.jetbrains\.kotlin[.:]/.test(name)
const isCompose = (name: string) => /^org\.jetbrains\.compose[.:]/.test(name)
const isKsp = (name: string) => /^com\.google\.devtools\.ksp[.:]/.test(name)
const MULTIPLATFORM = 'org.jetbrains.kotlin.multiplatform:org.jetbrains.kotlin.multiplatform.gradle.plugin'
const ANDROID_APP_OR_LIBRARY = /^com\.android\.(application|library):/
const KAPT = /^org\.jetbrains\.kotlin\.(kapt|plugin\.kapt):|^kotlin-kapt$/

// The Gradle version the wrapper downloads, from its distributionUrl.
export function gradleVersionOf(files: Files): string | undefined {
  return /distributionUrl\s*=.*gradle-(\d+(?:\.\d+){0,2}(?:-[\w.]+)?)-(?:bin|all)\.zip/.exec(files[WRAPPER] ?? '')?.[1]
}

const minor = (version: string) => /^(\d+\.\d+)/.exec(version)?.[1]
const below = (version: string, minimum: string) => {
  const a = parseVersion(version)
  const b = parseVersion(minimum)
  return a !== undefined && b !== undefined && compare(a, b) < 0
}

// The version the project uses of a tool: the highest its declarations write.
function versionOf(deps: Dep[], test: (name: string) => boolean): string | undefined {
  const found = deps.filter(d => test(d.name)).map(d => d.installed ?? d.spec).filter(v => parseVersion(v) !== undefined)
  return found.sort((a, b) => compare(parseVersion(b)!, parseVersion(a)!))[0]
}

// What going up to `u.latest` breaks in the rest of the build, in words.
export function kmpConflicts(u: Upgrade, deps: Dep[], files: Files): string[] {
  const conflicts: string[] = []
  const gradle = gradleVersionOf(files)
  const agp = versionOf(deps, isAgp)
  const kotlin = versionOf(deps, isKotlinTool)
  const target = u.latest

  if (isAgp(u.name)) {
    const key = minor(target)
    const needs = key ? AGP_GRADLE[key] : undefined
    if (!needs) conflicts.push(`AGP ${target} es más nuevo que la tabla de Google que conozco (hasta 9.5): confirma qué Gradle necesita`)
    else if (!gradle) conflicts.push(`AGP ${target} necesita Gradle ${needs} o más y no encontré ${WRAPPER} para confirmarlo`)
    else if (below(gradle, needs)) conflicts.push(`AGP ${target} necesita Gradle ${needs} o más; el wrapper usa ${gradle}`)
    // Crossing into AGP 9, where Kotlin is built in; a project already there
    // has dealt with it.
    const major = parseVersion(target)?.major ?? 0
    const from = parseVersion(u.current)?.major ?? 0
    if (major >= 9 && from < 9) {
      if (deps.some(d => d.name === MULTIPLATFORM) && deps.some(d => ANDROID_APP_OR_LIBRARY.test(d.name))) {
        conflicts.push(`AGP ${target} no permite org.jetbrains.kotlin.multiplatform junto a com.android.library o com.android.application: los módulos KMP pasan a com.android.kotlin.multiplatform.library`)
      }
      if (deps.some(d => KAPT.test(d.name))) conflicts.push(`AGP ${target} trae Kotlin integrado, que no funciona con kapt: hay que pasar a KSP o usar com.android.legacy-kapt`)
    }
  }

  if (isKotlinTool(u.name)) {
    const needs = KOTLIN_MINIMUMS.find(k => !below(target, k.from))
    if (needs && agp && below(agp, needs.agp)) conflicts.push(`Kotlin ${target} necesita AGP ${needs.agp} o más; el proyecto usa ${agp}`)
    if (needs && gradle && below(gradle, needs.gradle)) conflicts.push(`Kotlin ${target} necesita Gradle ${needs.gradle} o más; el wrapper usa ${gradle}`)
  }

  if (isCompose(u.name)) {
    const key = minor(target)
    const needs = key ? COMPOSE_MINIMUMS[key] : undefined
    if (!needs) conflicts.push(`Compose Multiplatform ${target} es más nuevo que lo que sé de sus requisitos (hasta 1.12): confirma qué Kotlin y AGP necesita`)
    else {
      if (needs.kotlin && kotlin && below(kotlin, needs.kotlin)) conflicts.push(`Compose Multiplatform ${target} necesita Kotlin ${needs.kotlin} o más; el proyecto usa ${kotlin}`)
      if (needs.agp && agp && below(agp, needs.agp)) conflicts.push(`Compose Multiplatform ${target} necesita AGP ${needs.agp} o más; el proyecto usa ${agp}`)
    }
  }

  if (isKsp(u.name) && !below(target, KSP_AGP.from) && agp && below(agp, KSP_AGP.agp)) {
    conflicts.push(`KSP ${target} necesita AGP ${KSP_AGP.agp} o más; el proyecto usa ${agp}`)
  }
  return conflicts
}

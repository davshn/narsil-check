// The Gradle a project's wrapper downloads: a dependency of its own, written
// in gradle-wrapper.properties, with the latest release from Gradle's version
// service. Only the root wrapper: the one under android/ belongs to React
// Native or Flutter, which choose its version themselves.

import type { Adapter } from './adapter'
import { escapeRegex } from './adapter'
import { WRAPPER, gradleVersionOf } from './kmp'

const NAME = 'gradle-wrapper'
const CURRENT = 'https://services.gradle.org/versions/current'

// "20261106154935+0000", as the service writes a build's time.
function buildDate(stamp: unknown): string | undefined {
  if (typeof stamp !== 'string') return undefined
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)([+-]\d\d)(\d\d)$/.exec(stamp)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}:${m[8]}` : undefined
}

export const GRADLE_WRAPPER: Adapter = {
  id: 'gradle-wrapper',
  label: 'Gradle wrapper',
  manifests: [WRAPPER],
  lockfiles: [],
  parse: files => {
    const version = gradleVersionOf(files)
    return version ? [{ name: NAME, spec: version, isDev: false, installed: version, source: `file:${WRAPPER}` }] : []
  },
  latestUrl: () => CURRENT,
  latestOf: text => {
    const version = (JSON.parse(text) as { version?: unknown }).version
    return typeof version === 'string' ? version : undefined
  },
  releasedUrls: () => [CURRENT],
  releasedOf: text => buildDate((JSON.parse(text) as { buildTime?: unknown }).buildTime),
  // A checksum belongs to one distribution, and only Gradle can name the next.
  conflictsOf: (u, _, files) =>
    /^\s*distributionSha256Sum\s*=/m.test(files[WRAPPER] ?? '') ? [`El wrapper verifica distributionSha256Sum: súbelo con ./gradlew wrapper --gradle-version ${u.latest} --gradle-distribution-sha256-sum <suma>`] : [],
  rewrite: (files, upgrades) => {
    const text = files[WRAPPER]
    const u = upgrades.find(x => x.name === NAME)
    if (text === undefined || !u) return {}
    return { [WRAPPER]: text.replace(new RegExp(`(distributionUrl\\s*=.*gradle-)${escapeRegex(u.spec)}(-(?:bin|all)\\.zip)`), `$1${u.latest}$2`) }
  },
  // The wrapper downloads the new distribution on its next run.
  installArgv: () => [],
  managerOf: () => 'gradle wrapper',
  importPattern: () => 'distributionUrl',
  repoUrlFor: () => 'https://github.com/gradle/gradle',
  repoUrlOf: () => undefined,
}

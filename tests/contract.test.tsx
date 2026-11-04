import { expect, test } from 'claude-code/testing'

import { globRegex, manifestsOf } from '../hooks/adapter'
import type { Adapter } from '../hooks/adapter'
import { bumpOf, compare, parseVersion, show } from '../hooks/semver'
import type { Version } from '../hooks/semver'

const v = (text: string): Version => {
  const parsed = parseVersion(text)
  if (!parsed) throw new Error(`not a version: ${text}`)
  return parsed
}

test('a version may have a fourth part, and it counts', () => {
  expect(show(v('8.1.4.1'))).toBe('8.1.4.1')
  expect(compare(v('8.1.4.2'), v('8.1.4.1'))).toBeGreaterThan(0)
  expect(compare(v('8.1.4'), v('8.1.4.0'))).toBe(0)
  expect(bumpOf(v('8.1.4'), v('8.1.4.1'))).toBe('patch')
  expect(bumpOf(v('7.1.3.4'), v('8.1.4.1'))).toBe('major')
  // A Maven qualifier after a dot is a prerelease-style suffix.
  expect(v('5.6.15.Final').pre).toBe('Final')
  expect(show(v('33.2.1-jre'))).toBe('33.2.1-jre')
  // Three parts and fewer read as before, with no fourth.
  expect(v('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: '' })
})

test('a glob matches at any depth with **/ and within one directory with *', () => {
  expect(globRegex('**/build.gradle.kts').test('build.gradle.kts')).toBe(true)
  expect(globRegex('**/build.gradle.kts').test('core/data/build.gradle.kts')).toBe(true)
  expect(globRegex('**/*.csproj').test('src/Api/Api.csproj')).toBe(true)
  expect(globRegex('**/*.csproj').test('Api.csproj.user')).toBe(false)
  expect(globRegex('gradle/*.versions.toml').test('gradle/libs.versions.toml')).toBe(true)
  expect(globRegex('gradle/*.versions.toml').test('gradle/x/libs.versions.toml')).toBe(false)
})

test('the manifests are the root ones and the globbed ones, never a lockfile', () => {
  const adapter = { manifests: ['pom.xml'], lockfiles: ['gradle.lockfile'], globs: ['**/build.gradle.kts'] } as unknown as Adapter
  expect(manifestsOf(adapter, ['pom.xml', 'gradle.lockfile', 'app/build.gradle.kts', 'README.md'])).toEqual(['pom.xml', 'app/build.gradle.kts'])
})

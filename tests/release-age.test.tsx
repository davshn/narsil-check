import { expect, test } from 'claude-code/testing'

import { CARGO } from '../hooks/cargo'
import { GO, majorPath } from '../hooks/golang'
import { MAVEN } from '../hooks/maven'
import { ageConflict } from '../hooks/npm'
import { NUGET } from '../hooks/nuget'
import { PUB } from '../hooks/pub'
import { PYPI } from '../hooks/pypi'
import { RUBYGEMS } from '../hooks/rubygems'
import { SWIFTPM } from '../hooks/swiftpm'

// Each registry's answer, trimmed to what the date is read from, as each one
// answered a real package on 2026-11-06.
test('each registry says where and when a version was published', () => {
  expect(PYPI.releasedUrls?.('requests', '2.32.3')).toEqual(['https://pypi.org/pypi/requests/2.32.3/json'])
  // The earliest file of the release.
  expect(PYPI.releasedOf?.(JSON.stringify({ urls: [{ upload_time_iso_8601: '2024-05-29T15:37:49Z' }, { upload_time_iso_8601: '2024-05-29T15:37:47Z' }] }), {})).toBe('2024-05-29T15:37:47Z')

  expect(CARGO.releasedUrls?.('serde', '1.0.200')).toEqual(['https://crates.io/api/v1/crates/serde/1.0.200'])
  expect(CARGO.releasedOf?.(JSON.stringify({ version: { created_at: '2024-05-01T16:00:47.131059Z' } }), {})).toBe('2024-05-01T16:00:47.131059Z')

  expect(GO.releasedUrls?.('github.com/go-chi/chi/v5', 'v5.0.12')).toEqual(['https://proxy.golang.org/github.com/go-chi/chi/v5/@v/v5.0.12.info'])
  expect(GO.releasedOf?.(JSON.stringify({ Version: 'v5.0.12', Time: '2024-02-17T00:24:11Z' }), {})).toBe('2024-02-17T00:24:11Z')

  expect(PUB.releasedUrls?.('http', '1.2.0')).toEqual(['https://pub.dev/api/packages/http/versions/1.2.0'])
  expect(PUB.releasedOf?.(JSON.stringify({ version: '1.2.0', published: '2024-01-16T22:46:38.816321Z' }), {})).toBe('2024-01-16T22:46:38.816321Z')

  // The SemVer 1 hive, then the SemVer 2 one for a package with SemVer 2 versions only.
  expect(NUGET.releasedUrls?.('Newtonsoft.Json', '13.0.3')).toEqual([
    'https://api.nuget.org/v3/registration5-semver1/newtonsoft.json/13.0.3.json',
    'https://api.nuget.org/v3/registration5-gz-semver2/newtonsoft.json/13.0.3.json',
  ])
  expect(NUGET.releasedOf?.(JSON.stringify({ published: '2023-03-08T07:42:54.647+00:00' }), {})).toBe('2023-03-08T07:42:54.647+00:00')

  expect(RUBYGEMS.releasedUrls?.('rails', '7.1.3')).toEqual(['https://rubygems.org/api/v2/rubygems/rails/versions/7.1.3.json'])
  expect(RUBYGEMS.releasedOf?.(JSON.stringify({ created_at: '2024-01-16T22:56:14.291Z' }), {})).toBe('2024-01-16T22:56:14.291Z')

  // Maven: the POM's Last-Modified, where its repository serves it, and on
  // the Plugin Portal for a Gradle plugin published as a library.
  expect(MAVEN.releasedUrls?.('io.ktor:ktor-client-core', '2.3.12')).toEqual([
    'https://repo1.maven.org/maven2/io/ktor/ktor-client-core/2.3.12/ktor-client-core-2.3.12.pom',
    'https://plugins.gradle.org/m2/io/ktor/ktor-client-core/2.3.12/ktor-client-core-2.3.12.pom',
  ])
  expect(MAVEN.releasedUrls?.('androidx.core:core-ktx', '1.13.1')?.[0]).toBe('https://dl.google.com/android/maven2/androidx/core/core-ktx/1.13.1/core-ktx-1.13.1.pom')
  expect(MAVEN.releasedOf?.('<project/>', { 'last-modified': 'Thu, 20 Jun 2024 10:25:00 GMT' })).toBe('2024-06-20T10:25:00.000Z')
  expect(MAVEN.releasedOf?.('<project/>', {})).toBeUndefined()

  // SwiftPM: on GitHub, when the tag's release was published (a date GitHub
  // sets, not the commit's, which the author can backdate), bare or with a v.
  expect(SWIFTPM.releasedUrls?.('https://github.com/Alamofire/Alamofire.git', '5.9.1')).toEqual([
    'https://api.github.com/repos/Alamofire/Alamofire/releases/tags/5.9.1',
    'https://api.github.com/repos/Alamofire/Alamofire/releases/tags/v5.9.1',
  ])
  expect(SWIFTPM.releasedOf?.(JSON.stringify({ tag_name: '5.9.1', published_at: '2024-03-31T01:22:33Z', created_at: '2024-03-31T01:21:38Z' }), {})).toBe('2024-03-31T01:22:33Z')
  // Off GitHub no date is known, so the wait blocks it.
  expect(SWIFTPM.releasedUrls?.('https://gitlab.com/x/y.git', '1.0.0')).toEqual([])
})

test("a Go version lives at its major's module path, whatever path declared it", () => {
  expect(majorPath('github.com/go-chi/chi', 'v5.0.12')).toBe('github.com/go-chi/chi/v5')
  expect(majorPath('github.com/go-chi/chi/v4', 'v5.0.12')).toBe('github.com/go-chi/chi/v5')
  expect(majorPath('github.com/pkg/errors', 'v0.9.1')).toBe('github.com/pkg/errors')
  expect(majorPath('gopkg.in/yaml.v2', 'v3.0.1')).toBe('gopkg.in/yaml.v3')
  expect(GO.releasedUrls?.('github.com/BurntSushi/toml', '1.4.0')).toEqual(['https://proxy.golang.org/github.com/!burnt!sushi/toml/@v/v1.4.0.info'])
})

test('a version whose date cannot be read waits a day from when the mod first saw it', () => {
  const now = Date.parse('2026-11-06T10:00:00Z')
  const seen = (hours: number) => now - hours * 60 * 60 * 1000
  expect(ageConflict(undefined, now, 1440, 'narsil', seen(3))).toBe('No pude leer cuándo se publicó y la vi por primera vez hace 3 h: Narsil Check espera 24 h antes de subirla')
  expect(ageConflict(undefined, now, 1440, 'narsil', seen(25))).toBeUndefined()
  // A date read wins over when it was seen.
  expect(ageConflict('2026-11-06T09:00:00Z', now, 1440, 'narsil', seen(30))).toBe('Publicada hace 1 h: Narsil Check espera 24 h antes de subirla')
})

test("the mod's own wait says so, in every ecosystem", () => {
  const now = Date.parse('2026-11-06T10:00:00Z')
  expect(ageConflict('2026-11-06T07:00:00Z', now, 1440, 'narsil')).toBe('Publicada hace 3 h: Narsil Check espera 24 h antes de subirla')
  expect(ageConflict(undefined, now, 1440, 'narsil')).toBe('No pude leer cuándo se publicó: Narsil Check espera 24 h antes de subirla')
  expect(ageConflict('2026-11-05T09:00:00Z', now, 1440, 'narsil')).toBeUndefined()
})

test('a Go +incompatible version lives at the base path, never under /vN', () => {
  expect(majorPath('github.com/docker/docker', 'v28.5.2+incompatible')).toBe('github.com/docker/docker')
  expect(GO.releasedUrls?.('github.com/docker/docker', 'v28.5.2+incompatible')).toEqual(['https://proxy.golang.org/github.com/docker/docker/@v/v28.5.2+incompatible.info'])
})

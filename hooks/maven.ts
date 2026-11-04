// Kotlin and Java on Maven repositories: Gradle's version catalog read
// exactly, build.gradle(.kts) files as well as code allows, and pom.xml;
// the latest stable release from Google Maven, the Gradle Plugin Portal or
// Maven Central; and the files rewritten in place for the bump group.

import type { Upgrade } from '../types'
import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex, globRegex } from './adapter'
import { compare, parseVersion } from './semver'
import type { Version } from './semver'
import { parseToml, tableOf } from './toml'
import type { TomlTable, TomlValue } from './toml'

export const CATALOG = 'gradle/libs.versions.toml'
const GRADLE_GLOBS = ['**/build.gradle.kts', '**/build.gradle']
const POM_GLOB = '**/pom.xml'

// A plugin id's marker artifact: how a Gradle plugin is published.
export function pluginCoordinate(id: string): string {
  return `${id}:${id}.gradle.plugin`
}

// The repository that serves a coordinate: Google's own artifacts are on
// Google Maven, Gradle plugins on the Plugin Portal, the rest on Central.
export function repositoryOf(group: string, artifact: string): string {
  if (/^(androidx|com\.android|com\.google\.android|com\.google\.firebase|com\.google\.gms|com\.google\.mlkit|com\.crashlytics)(\.|$)/.test(group)) {
    return 'https://dl.google.com/android/maven2'
  }
  if (artifact.endsWith('.gradle.plugin')) return 'https://plugins.gradle.org/m2'
  return 'https://repo1.maven.org/maven2'
}

function split(name: string): [string, string] {
  const [group, artifact] = name.split(':')
  return [group ?? '', artifact ?? '']
}

export function metadataUrl(name: string): string {
  const [group, artifact] = split(name)
  return `${repositoryOf(group, artifact)}/${group.replace(/\./g, '/')}/${artifact}/maven-metadata.xml`
}

export function pomUrl(name: string, version: string): string {
  const [group, artifact] = split(name)
  return `${repositoryOf(group, artifact)}/${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.pom`
}

// A prerelease by its qualifier: 2.12.0-alpha05, 9.6.0-rc01, 6.0.0-M1,
// 1.0-SNAPSHOT, 2.5.0-Beta2. A platform qualifier (33.2.1-jre) is a release.
const UNSTABLE = /(alpha|beta|rc|cr|milestone|snapshot|dev|eap|preview|pre|^m\d+$|-m\d+)/i

export function isStable(version: string): boolean {
  const v = parseVersion(version)
  return v !== undefined && !(v.pre && UNSTABLE.test(v.pre))
}

// The highest stable release maven-metadata.xml lists. Its <release> may be
// a prerelease (lifecycle 2.12.0-alpha05), so the list decides.
export function latestStable(xml: string): string | undefined {
  let best: { text: string; v: Version } | undefined
  for (const m of xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)) {
    const text = m[1] as string
    if (!isStable(text)) continue
    const v = parseVersion(text) as Version
    if (!best || compare(v, best.v) > 0) best = { text, v }
  }
  return best?.text
}

// A catalog version: "1.2.3", or { require | strictly | prefer = "1.2.3" }.
function catalogVersion(value: TomlValue | undefined): string | undefined {
  if (typeof value === 'string') return value
  const t = tableOf(value)
  const v = t?.require ?? t?.strictly ?? t?.prefer
  return typeof v === 'string' ? v : undefined
}

type Entry = { coordinate: string; version?: string; ref?: string; alias: string; kind: 'libraries' | 'plugins' }

function catalogEntries(catalog: TomlTable): Entry[] {
  const entries: Entry[] = []
  for (const [alias, value] of Object.entries(tableOf(catalog.libraries) ?? {})) {
    if (typeof value === 'string') {
      const [group, artifact, version] = value.split(':')
      if (group && artifact && version) entries.push({ coordinate: `${group}:${artifact}`, version, alias, kind: 'libraries' })
      continue
    }
    const t = tableOf(value)
    if (!t) continue
    const module = typeof t.module === 'string' ? t.module : typeof t.group === 'string' && typeof t.name === 'string' ? `${t.group}:${t.name}` : undefined
    if (!module) continue
    const ref = tableOf(t.version)?.ref
    entries.push({ coordinate: module, version: catalogVersion(t.version), ref: typeof ref === 'string' ? ref : undefined, alias, kind: 'libraries' })
  }
  for (const [alias, value] of Object.entries(tableOf(catalog.plugins) ?? {})) {
    if (typeof value === 'string') {
      const [id, version] = value.split(':')
      if (id && version) entries.push({ coordinate: pluginCoordinate(id), version, alias, kind: 'plugins' })
      continue
    }
    const t = tableOf(value)
    if (!t || typeof t.id !== 'string') continue
    const ref = tableOf(t.version)?.ref
    entries.push({ coordinate: pluginCoordinate(t.id), version: catalogVersion(t.version), ref: typeof ref === 'string' ? ref : undefined, alias, kind: 'plugins' })
  }
  return entries
}

// The catalog's dependencies, one per version: a version.ref several
// libraries share (ktor for eight) is one row, raised once.
export function parseCatalog(text: string): Dep[] {
  const catalog = parseToml(text)
  const versions = tableOf(catalog.versions) ?? {}
  const entries = catalogEntries(catalog)
  const deps: Dep[] = []
  const byRef = new Map<string, Entry[]>()
  for (const e of entries) {
    if (e.ref) byRef.set(e.ref, [...(byRef.get(e.ref) ?? []), e])
    else if (e.version) {
      deps.push({ name: e.coordinate, spec: e.version, isDev: false, installed: e.version, display: e.kind === 'plugins' ? e.coordinate.split(':')[0] : undefined, source: `catalog:${e.kind}.${e.alias}` })
    }
  }
  for (const [ref, list] of byRef) {
    const version = catalogVersion(versions[ref])
    if (!version) continue
    // A library is asked for before a plugin marker: Central answers for most.
    const lead = list.find(e => e.kind === 'libraries') ?? (list[0] as Entry)
    deps.push({ name: lead.coordinate, spec: version, isDev: false, installed: version, display: list.length > 1 ? `${ref} (${list.length})` : ref, source: `catalog:versions.${ref}` })
  }
  return deps
}

// Coordinates written into a build file: "group:artifact:version" in any
// configuration, and `id("x") version "1.2"` plugins. Versions held in a
// variable ($kotlinVersion) are code, not text, and left out.
export function parseGradle(text: string, path: string): Dep[] {
  const deps: Dep[] = []
  for (const m of text.matchAll(/(\w+)\s*\(?\s*["']([\w.-]+):([\w.-]+):([0-9][\w.+-]*)["']/g)) {
    const [, config, group, artifact, version] = m as unknown as [string, string, string, string, string]
    deps.push({ name: `${group}:${artifact}`, spec: version, isDev: /test/i.test(config), installed: version, source: `file:${path}` })
  }
  for (const m of text.matchAll(/\bid\s*\(?\s*["']([\w.-]+)["']\s*\)?\s+version\s+["']([0-9][^"']*)["']/g)) {
    const [, id, version] = m as unknown as [string, string, string]
    deps.push({ name: pluginCoordinate(id), spec: version, isDev: false, installed: version, display: id, source: `file:${path}` })
  }
  return deps
}

function tag(block: string, name: string): string | undefined {
  return new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`).exec(block)?.[1]
}

// pom.xml's dependencies and build plugins, with ${property} versions read
// from <properties>. A version a parent POM or a BOM manages is left out.
export function parsePom(text: string, path: string): Dep[] {
  const props = new Map<string, string>()
  const properties = /<properties>([\s\S]*?)<\/properties>/.exec(text)?.[1] ?? ''
  for (const m of properties.matchAll(/<([\w.-]+)>\s*([^<]+?)\s*<\/\1>/g)) props.set(m[1] as string, m[2] as string)
  const deps: Dep[] = []
  for (const m of text.matchAll(/<(dependency|plugin)>([\s\S]*?)<\/\1>/g)) {
    const block = m[2] as string
    const group = tag(block, 'groupId') ?? (m[1] === 'plugin' ? 'org.apache.maven.plugins' : undefined)
    const artifact = tag(block, 'artifactId')
    const raw = tag(block, 'version')
    if (!group || !artifact || !raw) continue
    const prop = /^\$\{([\w.-]+)\}$/.exec(raw)?.[1]
    const version = prop ? props.get(prop) : raw
    if (!version || !/^\d/.test(version)) continue
    const name = `${group}:${artifact}`
    if (deps.some(d => d.name === name)) continue
    deps.push({ name, spec: version, isDev: tag(block, 'scope') === 'test', installed: version, source: prop ? `pom-prop:${path}:${prop}` : `pom:${path}` })
  }
  return deps
}

export function parseMaven(files: Files): Dep[] {
  const deps: Dep[] = []
  const add = (list: Dep[]) => {
    for (const d of list) if (!deps.some(e => e.name === d.name)) deps.push(d)
  }
  if (files[CATALOG] !== undefined) add(parseCatalog(files[CATALOG]))
  const gradle = GRADLE_GLOBS.map(globRegex)
  const pom = globRegex(POM_GLOB)
  for (const [path, text] of Object.entries(files)) {
    if (gradle.some(g => g.test(path))) add(parseGradle(text, path))
    else if (pom.test(path)) add(parsePom(text, path))
  }
  return deps
}

// The files with each upgrade's version raised where `source` says it is
// written, every other byte as it was.
export function rewriteMaven(files: Files, upgrades: Upgrade[]): Files {
  const out: Files = {}
  const edit = (path: string, change: (text: string) => string) => {
    const text = out[path] ?? files[path]
    if (text !== undefined) out[path] = change(text)
  }
  for (const u of upgrades) {
    const source = u.source ?? ''
    const old = escapeRegex(u.spec)
    if (source.startsWith('catalog:versions.')) {
      const ref = escapeRegex(source.slice('catalog:versions.'.length))
      // ktor = "3.6.1", or ktor = { strictly = "3.6.1" }.
      edit(CATALOG, t => t.replace(new RegExp(`^(\\s*"?${ref}"?\\s*=\\s*(?:\\{[^}\\n]*?)?")${old}(")`, 'm'), `$1${u.latest}$2`))
    } else if (source.startsWith('catalog:')) {
      const alias = escapeRegex(source.slice(source.indexOf('.') + 1))
      edit(CATALOG, t => t.replace(new RegExp(`^(\\s*"?${alias}"?\\s*=.*?)${old}(.*)$`, 'm'), `$1${u.latest}$2`))
    } else if (source.startsWith('file:')) {
      const path = source.slice('file:'.length)
      const [group, artifact] = split(u.name)
      edit(path, t =>
        artifact.endsWith('.gradle.plugin')
          ? t.replace(new RegExp(`(\\bid\\s*\\(?\\s*["']${escapeRegex(group)}["']\\s*\\)?\\s+version\\s+["'])${old}(["'])`), `$1${u.latest}$2`)
          : t.split(`${group}:${artifact}:${u.spec}`).join(`${group}:${artifact}:${u.latest}`),
      )
    } else if (source.startsWith('pom-prop:')) {
      const [, path, prop] = source.split(':') as [string, string, string]
      edit(path, t => t.replace(new RegExp(`(<${escapeRegex(prop)}>\\s*)${old}(\\s*</${escapeRegex(prop)}>)`), `$1${u.latest}$2`))
    } else if (source.startsWith('pom:')) {
      const path = source.slice('pom:'.length)
      const [group, artifact] = split(u.name)
      edit(path, t =>
        t.replace(/<(dependency|plugin)>[\s\S]*?<\/\1>/g, block =>
          tag(block, 'artifactId') === artifact && (tag(block, 'groupId') ?? 'org.apache.maven.plugins') === group
            ? block.replace(new RegExp(`(<version>\\s*)${old}(\\s*</version>)`), `$1${u.latest}$2`)
            : block,
        ),
      )
    }
  }
  return out
}

export const MAVEN: Adapter = {
  id: 'maven',
  label: 'Maven',
  manifests: [CATALOG, 'pom.xml', 'build.gradle.kts', 'build.gradle'],
  globs: [...GRADLE_GLOBS, POM_GLOB],
  lockfiles: [],
  parse: parseMaven,
  latestUrl: metadataUrl,
  // A Gradle plugin's own artifact (org.jlleitschuh.gradle:ktlint-gradle) is
  // on the Plugin Portal, not Central.
  alternateUrl: name => {
    const [group, artifact] = split(name)
    const portal = 'https://plugins.gradle.org/m2'
    return repositoryOf(group, artifact) === portal ? undefined : `${portal}/${group.replace(/\./g, '/')}/${artifact}/maven-metadata.xml`
  },
  latestOf: latestStable,
  rewrite: rewriteMaven,
  // Gradle and Maven fetch the new versions on the next build.
  installArgv: () => [],
  managerOf: present => (present.some(p => p.endsWith('pom.xml')) ? 'maven' : 'gradle'),
  // A package is named after its group most of the time: import io.ktor.client.
  importPattern: name => `^[[:space:]]*import[[:space:]]+(static[[:space:]]+)?${escapeRegex(split(name)[0])}\\.`,
  infoUrl: pomUrl,
  repoUrlOf: pom => {
    const scm = /<scm>[\s\S]*?<url>\s*([^<\s]+)\s*<\/url>/.exec(pom)?.[1]
    const url = scm ?? /<url>\s*([^<\s]*github\.com[^<\s]*)\s*<\/url>/.exec(pom)?.[1]
    return url && url.includes('github.com') ? url : undefined
  },
}

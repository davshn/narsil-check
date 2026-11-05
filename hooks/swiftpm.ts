// Swift's Package Manager: the packages Package.swift and an Xcode app's
// project.pbxproj declare, the versions Package.resolved pins, and each
// package's latest release read from its own git tags (SwiftPM has no
// registry: a package is its git URL).

import type { Upgrade } from '../types'
import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex } from './adapter'
import { compare, parseVersion } from './semver'
import type { Version } from './semver'

const MANIFEST = 'Package.swift'
const RESOLVED = 'Package.resolved'
const PBXPROJ_GLOB = '**/*.xcodeproj/project.pbxproj'
const RESOLVED_GLOBS = [`**/*.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/${RESOLVED}`, `**/*.xcworkspace/xcshareddata/swiftpm/${RESOLVED}`]

// A package URL as one name: lower-case host, no ".git", no trailing slash,
// so https://github.com/Alamofire/Alamofire.git and its spelling in
// Package.resolved meet.
export function canonicalUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  return trimmed.replace(/^(\w+:\/\/)([^/]+)/, (_, scheme: string, host: string) => `${scheme}${host.toLowerCase()}`)
}

// A package's short name: the last segment of its URL.
export function packageName(url: string): string {
  return canonicalUrl(url).split('/').pop() ?? url
}

// Each `.package(...)` call's text, its parentheses balanced, so a nested
// `.upToNextMajor(from: "1.0.0")` stays inside.
function packageCalls(text: string): string[] {
  const calls: string[] = []
  for (const m of text.matchAll(/\.package\s*\(/g)) {
    let depth = 1
    let i = (m.index as number) + m[0].length
    const start = i
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
      else if (text[i] === '"') {
        // A string's parentheses are not the call's; an unclosed one ends it.
        const close = text.indexOf('"', i + 1)
        if (close < 0) break
        i = close
      }
    }
    calls.push(text.slice(start, i - 1))
  }
  return calls
}

// The lowest version a requirement allows: from: "1.2.0",
// .upToNextMajor(from:), .upToNextMinor(from:), exact:, .exact() and
// "1.0.0"..<"2.0.0". Undefined for a branch, a revision or a path.
export function minimumOf(requirement: string): string | undefined {
  if (/\b(branch|revision|path)\s*:/.test(requirement)) return undefined
  return /(?:from|exact)\s*:\s*"([^"]+)"/.exec(requirement)?.[1] ?? /\.exact\s*\(\s*"([^"]+)"/.exec(requirement)?.[1] ?? /"([0-9][^"]*)"\s*\.\.[.<]/.exec(requirement)?.[1]
}

export function parsePackageSwift(text: string, path: string): Dep[] {
  const deps: Dep[] = []
  for (const call of packageCalls(text)) {
    const url = /\burl\s*:\s*"([^"]+)"/.exec(call)?.[1]
    const minimum = minimumOf(call)
    if (!url || !minimum) continue
    deps.push({ name: canonicalUrl(url), spec: minimum, isDev: false, display: packageName(url), source: `file:${path}` })
  }
  return deps
}

// An Xcode app's packages: each XCRemoteSwiftPackageReference with a
// version requirement (a branch or revision one is left out).
export function parsePbxproj(text: string, path: string): Dep[] {
  const deps: Dep[] = []
  for (const m of text.matchAll(/isa\s*=\s*XCRemoteSwiftPackageReference;\s*repositoryURL\s*=\s*"?([^";]+)"?;\s*requirement\s*=\s*\{([^}]*)\}/g)) {
    const url = m[1] as string
    const requirement = m[2] as string
    if (/kind\s*=\s*(branch|revision)\b/.test(requirement)) continue
    const minimum = /(?:minimumVersion|version)\s*=\s*"?([0-9][^";]*)"?;/.exec(requirement)?.[1]
    if (minimum) deps.push({ name: canonicalUrl(url), spec: minimum, isDev: false, display: packageName(url), source: `file:${path}` })
  }
  return deps
}

// What Package.resolved pins, by canonical URL: version 1's object.pins
// with repositoryURL, versions 2 and 3's pins with location.
export function resolvedVersions(text: string): Map<string, string> {
  const pins = new Map<string, string>()
  try {
    const json = JSON.parse(text) as { pins?: unknown[]; object?: { pins?: unknown[] } }
    for (const pin of json.pins ?? json.object?.pins ?? []) {
      const p = pin as { location?: unknown; repositoryURL?: unknown; state?: { version?: unknown } }
      const url = typeof p.location === 'string' ? p.location : typeof p.repositoryURL === 'string' ? p.repositoryURL : undefined
      if (url && typeof p.state?.version === 'string') pins.set(canonicalUrl(url), p.state.version)
    }
  } catch {
    // An unreadable Package.resolved: versions come from the requirements.
  }
  return pins
}

export function parseSwiftpm(files: Files): Dep[] {
  const pins = new Map<string, string>()
  for (const [path, text] of Object.entries(files)) if (path.endsWith(RESOLVED)) for (const [url, v] of resolvedVersions(text)) pins.set(url, v)
  const deps: Dep[] = []
  for (const [path, text] of Object.entries(files)) {
    const found = path === MANIFEST || path.endsWith(`/${MANIFEST}`) ? parsePackageSwift(text, path) : path.endsWith('project.pbxproj') ? parsePbxproj(text, path) : []
    for (const d of found) if (!deps.some(e => e.name === d.name)) deps.push({ ...d, installed: pins.get(d.name) ?? d.spec })
  }
  return deps
}

// The highest plain release among `git ls-remote --tags --refs` lines
// ("<sha>\trefs/tags/v1.8.2"), without its "v": a tag with a prerelease
// part (5.0.0-beta.1) is not one.
export function latestTag(stdout: string): string | undefined {
  let best: { text: string; v: Version } | undefined
  for (const line of stdout.split(/\r?\n/)) {
    const tag = /refs\/tags\/v?([0-9][^\s^]*)$/.exec(line.trim())?.[1]
    if (!tag || tag.includes('-')) continue
    const v = parseVersion(tag)
    if (v && (!best || compare(v, best.v) > 0)) best = { text: tag, v }
  }
  return best?.text
}

// A file with each upgrade's minimum raised inside its own package's
// declaration, every other byte as it was.
export function rewriteSwift(text: string, upgrades: Upgrade[]): string {
  let out = text
  for (const u of upgrades) {
    const old = escapeRegex(u.spec)
    // Package.swift: the version literal inside the .package call for this URL.
    for (const call of packageCalls(out)) {
      const url = /\burl\s*:\s*"([^"]+)"/.exec(call)?.[1]
      if (!url || canonicalUrl(url) !== u.name) continue
      const raised = call.replace(new RegExp(`"${old}"`), `"${u.latest}"`)
      if (raised !== call) out = out.replace(call, raised)
    }
    // project.pbxproj: minimumVersion or version in this URL's reference.
    out = out.replace(/(isa\s*=\s*XCRemoteSwiftPackageReference;\s*repositoryURL\s*=\s*"?([^";]+)"?;\s*requirement\s*=\s*\{)([^}]*)(\})/g, (block, head: string, url: string, body: string, end: string) =>
      canonicalUrl(url) === u.name ? `${head}${body.replace(new RegExp(`((?:minimumVersion|version)\\s*=\\s*"?)${old}("?;)`), `$1${u.latest}$2`)}${end}` : block,
    )
  }
  return out
}

// A package's module as code imports it, its capitals unknown:
// swift-argument-parser is ArgumentParser, swift-nio-ssl is NIOSSL.
export function moduleOf(name: string): string {
  return packageName(name).replace(/^swift-/, '').replace(/-/g, '')
}

// A pattern that matches a name whatever its capitals: nio is [Nn][Ii][Oo].
export function anyCase(name: string): string {
  return [...name].map(c => (/[a-z]/i.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : escapeRegex(c))).join('')
}

export const SWIFTPM: Adapter = {
  id: 'swiftpm',
  label: 'SwiftPM',
  manifests: [MANIFEST],
  globs: [PBXPROJ_GLOB, ...RESOLVED_GLOBS],
  lockfiles: [RESOLVED],
  parse: parseSwiftpm,
  latestUrl: name => name,
  latestCommand: name => ['git', 'ls-remote', '--tags', '--refs', name],
  latestOf: latestTag,
  rewrite: (files, upgrades) => {
    const out: Files = {}
    for (const [path, text] of Object.entries(files)) {
      if (!(path === MANIFEST || path.endsWith(`/${MANIFEST}`) || path.endsWith('project.pbxproj'))) continue
      const raised = rewriteSwift(text, upgrades)
      if (raised !== text) out[path] = raised
    }
    return out
  },
  // Package.resolved follows the raised minimums.
  installArgv: (present, upgrades) =>
    present.includes(MANIFEST)
      ? [['swift', 'package', 'update', ...upgrades.map(u => packageName(u.name).toLowerCase())]]
      : [['xcodebuild', '-resolvePackageDependencies']],
  managerOf: present => (present.includes(MANIFEST) ? 'swift' : 'xcode'),
  importPattern: name => `^[[:space:]]*(@testable[[:space:]]+)?import[[:space:]]+${anyCase(moduleOf(name))}([[:space:]]|$)`,
  repoUrlFor: name => (name.includes('github.com') ? name : undefined),
  repoUrlOf: () => undefined,
}

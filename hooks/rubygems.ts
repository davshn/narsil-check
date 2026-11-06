// Ruby's RubyGems: what the Gemfile declares (with its groups), what
// Gemfile.lock says is installed, rubygems.org's latest release, and how the
// bump group goes up with Bundler.

import type { Upgrade } from '../types'
import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex } from './adapter'

const MANIFEST = 'Gemfile'
const LOCK = 'Gemfile.lock'
const DEV_GROUPS = /:(development|test)\b/

// One `gem` line: its name, its requirements ("~> 7.1.0", ">= 1.1, < 2")
// and whether it names a group of its own. Undefined for a git, path or
// github source, which rubygems.org does not serve.
export function parseGemLine(line: string): { name: string; spec: string; isDev: boolean } | undefined {
  const m = /^\s*gem\s*\(?\s*["']([^"']+)["']\s*(.*)$/.exec(line.split(/\s#/)[0] ?? '')
  if (!m) return undefined
  const rest = m[2] as string
  if (/\b(git|path|github|gitlab|bitbucket)\s*:|:(git|path|github)\s*=>/.test(rest)) return undefined
  const requirements = [...rest.matchAll(/,\s*["']([~><=!]*\s*[0-9][^"']*)["']/g)].map(r => (r[1] as string).trim())
  return { name: m[1] as string, spec: requirements.join(', '), isDev: /\bgroups?\s*:\s*\[?[^\n]*:(development|test)\b/.test(rest) }
}

// A platform-specific lock entry keeps its version only: nokogiri
// (1.16.0-x86_64-linux) is 1.16.0.
export function lockVersion(text: string): string {
  return text.replace(/-(x86|x64|arm|aarch|java|universal|mingw|mswin|darwin|linux|musl)\S*$/, '')
}

// Every gem Gemfile.lock installs from rubygems.org: the specs of its GEM
// section (a GIT or PATH section's gems are not rubygems.org's).
export function lockedGems(lock: string): Map<string, string> {
  const locked = new Map<string, string>()
  let section = ''
  let inSpecs = false
  for (const line of lock.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      section = line.trim()
      inSpecs = false
    }
    if (/^ {2}specs:\s*$/.test(line)) {
      inSpecs = section === 'GEM'
      continue
    }
    // Four spaces: a gem; six: what that gem depends on.
    const spec = inSpecs ? /^ {4}([^\s(]+) \(([^)]+)\)\s*$/.exec(line) : null
    if (spec && !locked.has(spec[1] as string)) locked.set(spec[1] as string, lockVersion(spec[2] as string))
  }
  return locked
}

export function parseGemfile(files: Files): Dep[] {
  const text = files[MANIFEST]
  if (text === undefined) return []
  const locked = lockedGems(files[LOCK] ?? '')
  const deps: Dep[] = []
  // The groups each open `group ... do` block names, innermost last.
  const blocks: boolean[] = []
  for (const line of text.split(/\r?\n/)) {
    const opened = /^\s*group\b(.*)\bdo\s*(\|.*\|)?\s*$/.exec(line)
    if (opened) {
      blocks.push(DEV_GROUPS.test(opened[1] as string))
      continue
    }
    if (/^\s*(platforms?|source|install_if)\b.*\bdo\s*(\|.*\|)?\s*$/.test(line)) {
      blocks.push(blocks[blocks.length - 1] ?? false)
      continue
    }
    if (/^\s*end\s*$/.test(line)) {
      blocks.pop()
      continue
    }
    const gem = parseGemLine(line)
    if (!gem || deps.some(d => d.name === gem.name)) continue
    const isDev = gem.isDev || blocks.some(Boolean)
    deps.push({ name: gem.name, spec: gem.spec, isDev, installed: locked.get(gem.name) })
  }
  return deps
}

// The requirement written back: its first version raised, its operator kept:
// "~> 7.1.0" -> "~> 7.1.5", ">= 1.1, < 2" -> ">= 1.6.0, < 2".
export function gemSpecFor(spec: string, latest: string): string {
  return spec.replace(/^([~><=!]*\s*)[0-9][0-9A-Za-z.]*/, `$1${latest}`)
}

// The Gemfile with each upgrade's first requirement raised, every other
// byte as it was. A gem with no requirement is left as it is: Bundler
// takes it up.
export function rewriteGemfile(text: string, upgrades: Upgrade[]): string {
  return text
    .split('\n')
    .map(line => {
      const gem = parseGemLine(line)
      const u = gem ? upgrades.find(x => x.name === gem.name) : undefined
      if (!u || !gem?.spec) return line
      return line.replace(new RegExp(`(gem\\s*\\(?\\s*["']${escapeRegex(u.name)}["']\\s*,\\s*["'])([^"']+)(["'])`), (_, head: string, req: string, quote: string) => `${head}${gemSpecFor(req, u.latest)}${quote}`)
    })
    .join('\n')
}

export const RUBYGEMS: Adapter = {
  id: 'rubygems',
  label: 'RubyGems',
  manifests: [MANIFEST],
  lockfiles: [LOCK],
  parse: parseGemfile,
  latestUrl: name => `https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}/latest.json`,
  releasedUrls: (name, version) => [`https://rubygems.org/api/v2/rubygems/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}.json`],
  releasedOf: text => {
    const at = (JSON.parse(text) as { created_at?: unknown }).created_at
    return typeof at === 'string' ? at : undefined
  },
  headers: { accept: 'application/json' },
  latestOf: text => {
    const version = (JSON.parse(text) as { version?: unknown }).version
    // A RubyGems prerelease has letters in it: 8.0.0.beta1.
    return typeof version === 'string' && /^[0-9.]+$/.test(version) ? version : undefined
  },
  rewrite: (files, upgrades): Files => {
    const text = files[MANIFEST]
    return text === undefined ? {} : { [MANIFEST]: rewriteGemfile(text, upgrades) }
  },
  // Only these gems move: --conservative keeps what they share as it is.
  installArgv: (_, upgrades) => [['bundle', 'update', '--conservative', ...upgrades.map(u => u.name)]],
  managerOf: () => 'bundler',
  treeOf: files => [...lockedGems(files[LOCK] ?? '')].map(([name, version]) => ({ name, version })),
  importPattern: name => `require[[:space:](]+["']${escapeRegex(name)}(/[^"']*)?["']`,
  infoUrl: name => `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`,
  repoUrlOf: text => {
    const gem = JSON.parse(text) as { source_code_uri?: unknown; homepage_uri?: unknown }
    const urls = [gem.source_code_uri, gem.homepage_uri].filter((u): u is string => typeof u === 'string')
    return urls.find(u => u.includes('github.com'))
  },
}

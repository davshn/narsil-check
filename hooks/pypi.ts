// Python's PyPI: what pyproject.toml (PEP 621, PEP 735 groups and Poetry's
// tables) and requirements.txt declare, what uv.lock or poetry.lock says is
// installed, PyPI's latest release, and how the bump group goes up.

import type { Upgrade } from '../types'
import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex } from './adapter'
import { parseToml, tableOf } from './toml'
import type { TomlTable, TomlValue } from './toml'

const PYPROJECT = 'pyproject.toml'
const REQUIREMENTS = 'requirements.txt'
const DEV_REQUIREMENTS = 'requirements-dev.txt'
const LOCKS = ['uv.lock', 'poetry.lock']

// A distribution's name as PyPI compares it (PEP 503): lower case, runs of
// "-", "_" and "." as one "-".
export function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

// One PEP 508 requirement: "Django[argon2]~=4.2 ; python_version > '3.8'"
// is Django with "~=4.2". Undefined for a URL, a path or an option line.
export function parseRequirement(text: string): { name: string; spec: string } | undefined {
  const line = text.split(/\s+#/)[0]?.split(';')[0]?.trim() ?? ''
  if (!line || line.startsWith('-') || /^(git\+|https?:|file:|\.|\/)/.test(line) || line.includes(' @ ')) return undefined
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(line)
  if (!m) return undefined
  return { name: m[1] as string, spec: (m[3] as string).replace(/^\(|\)$/g, '').replace(/\s+/g, '') }
}

// The version a requirement is written from: "==2.31.0", "~=4.2" and
// ">=2.31,<3" are 2.31.0, 4.2 and 2.31. Undefined when it names none.
export function pinOf(spec: string): string | undefined {
  return /(?:===|==|~=|>=|\^|~)\s*v?([0-9][0-9A-Za-z.]*)/.exec(spec)?.[1]
}

function requirementsOf(text: string, isDev: boolean): Dep[] {
  const deps: Dep[] = []
  for (const line of text.split(/\r?\n/)) {
    const r = parseRequirement(line)
    if (r) deps.push({ name: r.name, spec: r.spec, isDev })
  }
  return deps
}

function stringsOf(value: TomlValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// pyproject.toml's dependencies: PEP 621's, its optional groups, PEP 735's
// groups and Poetry's tables.
function pyprojectOf(text: string): Dep[] {
  const t = parseToml(text)
  const deps: Dep[] = []
  const add = (name: string, spec: string, isDev: boolean) => {
    if (normalize(name) !== 'python' && !deps.some(d => normalize(d.name) === normalize(name))) deps.push({ name, spec, isDev })
  }
  const pep508 = (list: string[], isDev: boolean) => {
    for (const item of list) {
      const r = parseRequirement(item)
      if (r) add(r.name, r.spec, isDev)
    }
  }
  const project = tableOf(t.project)
  pep508(stringsOf(project?.dependencies), false)
  for (const group of Object.values(tableOf(project?.['optional-dependencies']) ?? {})) pep508(stringsOf(group), true)
  for (const group of Object.values(tableOf(t['dependency-groups']) ?? {})) pep508(stringsOf(group), true)
  const poetry = tableOf(tableOf(t.tool)?.poetry)
  const poetryTable = (table: TomlTable | undefined, isDev: boolean) => {
    for (const [name, value] of Object.entries(table ?? {})) {
      const spec = typeof value === 'string' ? value : tableOf(value)?.version
      if (typeof spec === 'string') add(name, spec, isDev)
    }
  }
  poetryTable(tableOf(poetry?.dependencies), false)
  poetryTable(tableOf(poetry?.['dev-dependencies']), true)
  for (const group of Object.values(tableOf(poetry?.group) ?? {})) poetryTable(tableOf(tableOf(group)?.dependencies), true)
  return deps
}

// What uv.lock or poetry.lock records as installed, by normalized name.
function lockedOf(files: Files): Map<string, string> {
  const locked = new Map<string, string>()
  for (const file of LOCKS) {
    const text = files[file]
    if (text === undefined) continue
    try {
      const t = parseToml(text)
      for (const p of (Array.isArray(t.package) ? t.package : []) as TomlValue[]) {
        const pkg = tableOf(p)
        if (pkg && typeof pkg.name === 'string' && typeof pkg.version === 'string') locked.set(normalize(pkg.name), pkg.version)
      }
    } catch {
      // An unreadable lockfile: versions come from the requirements.
    }
  }
  return locked
}

export function parsePypi(files: Files): Dep[] {
  const declared: Dep[] = []
  if (files[PYPROJECT] !== undefined) declared.push(...pyprojectOf(files[PYPROJECT]))
  if (files[REQUIREMENTS] !== undefined) declared.push(...requirementsOf(files[REQUIREMENTS], false))
  if (files[DEV_REQUIREMENTS] !== undefined) declared.push(...requirementsOf(files[DEV_REQUIREMENTS], true))
  const locked = lockedOf(files)
  const deps: Dep[] = []
  for (const d of declared) {
    if (deps.some(e => normalize(e.name) === normalize(d.name))) continue
    deps.push({ ...d, installed: locked.get(normalize(d.name)) ?? pinOf(d.spec) })
  }
  return deps
}

// The requirement written back: its first version raised, its operators
// and any upper bound kept: ">=2.31,<3" -> ">=2.34.2,<3".
export function pySpecFor(spec: string, latest: string): string {
  return spec.replace(/((?:===|==|~=|>=|\^|~)\s*)v?[0-9][0-9A-Za-z.*]*/, `$1${latest}`)
}

// A file with each upgrade's requirement raised, every other byte as it
// was: PEP 508 strings ("requests>=2.31") in pyproject.toml or
// requirements.txt, and Poetry's `requests = "^2.31"` lines.
export function rewritePypi(text: string, upgrades: Upgrade[]): string {
  let out = text
  for (const u of upgrades) {
    // PEP 503: "Foo_Bar", "foo-bar" and "foo.bar" are one name.
    const name = escapeRegex(u.name).replace(/(\\\.|_|-)+/g, '[-_.]+')
    const pep508 = new RegExp(`((?:^|["'\\s])${name}\\s*(?:\\[[^\\]]*\\])?\\s*)((?:===|==|~=|>=|<=|!=|<|>|\\^|~)[^;"'\\s#]*)`, 'gim')
    out = out.replace(pep508, (_, head: string, spec: string) => `${head}${pySpecFor(spec, u.latest)}`)
    const poetry = new RegExp(`^(\\s*"?${name}"?\\s*=\\s*(?:\\{[^}\\n]*\\bversion\\s*=\\s*)?")([^"]+)(")`, 'gim')
    out = out.replace(poetry, (_, head: string, spec: string, tailQuote: string) => `${head}${pySpecFor(spec, u.latest)}${tailQuote}`)
  }
  return out
}

// Common distributions whose import name is not their own.
const IMPORTS: Record<string, string> = {
  pyyaml: 'yaml',
  pillow: 'PIL',
  'beautifulsoup4': 'bs4',
  'scikit-learn': 'sklearn',
  'python-dateutil': 'dateutil',
  'opencv-python': 'cv2',
  'python-dotenv': 'dotenv',
  psycopg2: 'psycopg2',
  'psycopg2-binary': 'psycopg2',
  'google-cloud-storage': 'google.cloud.storage',
}

export function importNameOf(name: string): string {
  return IMPORTS[normalize(name)] ?? normalize(name).replace(/-/g, '_')
}

export const PYPI: Adapter = {
  id: 'pypi',
  label: 'PyPI',
  manifests: [PYPROJECT, REQUIREMENTS],
  lockfiles: [...LOCKS, DEV_REQUIREMENTS],
  parse: parsePypi,
  latestUrl: name => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
  headers: { accept: 'application/json' },
  latestOf: text => {
    const version = (JSON.parse(text) as { info?: { version?: unknown } }).info?.version
    return typeof version === 'string' ? version : undefined
  },
  rewrite: (files, upgrades) => {
    const out: Files = {}
    for (const file of [PYPROJECT, REQUIREMENTS, DEV_REQUIREMENTS]) {
      const text = files[file]
      if (text === undefined) continue
      const raised = rewritePypi(text, upgrades)
      if (raised !== text) out[file] = raised
    }
    return out
  },
  // The lockfile follows the raised requirements; with requirements.txt
  // alone there is no lockfile to refresh.
  installArgv: present => (present.includes('uv.lock') ? [['uv', 'lock']] : present.includes('poetry.lock') ? [['poetry', 'lock']] : []),
  managerOf: present => (present.includes('uv.lock') ? 'uv' : present.includes('poetry.lock') ? 'poetry' : 'pip'),
  // uv.lock or poetry.lock's packages.
  treeOf: files => [...lockedOf(files)].map(([name, version]) => ({ name, version })),
  importPattern: name => {
    const module = escapeRegex(importNameOf(name))
    return `^[[:space:]]*(import|from)[[:space:]]+${module}([.[:space:],]|$)`
  },
  repoUrlOf: text => {
    const info = (JSON.parse(text) as { info?: { project_urls?: Record<string, unknown>; home_page?: unknown } }).info
    const urls = [...Object.values(info?.project_urls ?? {}), info?.home_page].filter((u): u is string => typeof u === 'string')
    return urls.find(u => u.includes('github.com'))
  },
}

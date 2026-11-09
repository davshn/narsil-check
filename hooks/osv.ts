// Known vulnerabilities from OSV.dev, one source for every ecosystem: the
// batch query for the project's packages, each advisory's severity and
// fixing version, advisories that are one issue under two ids merged, and
// the text the copy buttons put on the clipboard. Pure: the hooks module
// fetches.

import type { Ecosystem, Finding, Severity, Vuln } from '../types'
import { compare, parseVersion } from './semver'

export const OSV_BATCH = 'https://api.osv.dev/v1/querybatch'
export const OSV_VULN = 'https://api.osv.dev/v1/vulns/'
// OSV takes at most 1000 queries per batch.
export const BATCH_SIZE = 500

// Each ecosystem as OSV names it.
export const OSV_ECOSYSTEM: Record<Ecosystem, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  go: 'Go',
  cargo: 'crates.io',
  pub: 'Pub',
  maven: 'Maven',
  nuget: 'NuGet',
  rubygems: 'RubyGems',
  swiftpm: 'SwiftURL',
  actions: 'GitHub Actions',
  // OSV has no such ecosystem, and one unknown name fails the whole batch.
  'gradle-wrapper': '',
}

// A package's name as OSV knows it: a Swift package is its URL with no
// scheme (github.com/vapor/vapor).
export function osvName(ecosystem: Ecosystem, name: string): string {
  return ecosystem === 'swiftpm' ? name.replace(/^\w+:\/\//, '').replace(/\.git$/, '') : name
}

export type Package = { name: string; version: string; ecosystem: Ecosystem; isDirect: boolean; display?: string }

export function batchBody(packages: Package[]): string {
  return JSON.stringify({
    queries: packages.map(p => ({ package: { name: osvName(p.ecosystem, p.name), ecosystem: OSV_ECOSYSTEM[p.ecosystem] }, version: p.version })),
  })
}

// The ids of the advisories each query of a batch answered, in order.
export function batchIds(text: string): { id: string; modified: string }[][] {
  const results = (JSON.parse(text) as { results?: { vulns?: { id?: unknown; modified?: unknown }[] }[] }).results ?? []
  return results.map(r => (r.vulns ?? []).filter(v => typeof v.id === 'string').map(v => ({ id: v.id as string, modified: typeof v.modified === 'string' ? v.modified : '' })))
}

// CVSS v3.x base score from its vector, as FIRST's specification computes it.
const WEIGHTS: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 },
}

function roundUp(n: number): number {
  const i = Math.round(n * 100000)
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10
}

export function cvss3Score(vector: string): number | undefined {
  if (!/^CVSS:3\.[01]\//.test(vector)) return undefined
  const m: Record<string, string> = {}
  for (const part of vector.split('/').slice(1)) {
    const [k, v] = part.split(':')
    if (k && v) m[k] = v
  }
  const scope = m.S
  const pr = m.PR === 'N' ? 0.85 : m.PR === 'L' ? (scope === 'C' ? 0.68 : 0.62) : m.PR === 'H' ? (scope === 'C' ? 0.5 : 0.27) : undefined
  const get = (k: string) => WEIGHTS[k]?.[m[k] ?? '']
  const [av, ac, ui, c, i, a] = [get('AV'), get('AC'), get('UI'), get('C'), get('I'), get('A')]
  if ([av, ac, ui, c, i, a, pr].some(x => x === undefined) || (scope !== 'U' && scope !== 'C')) return undefined
  const iss = 1 - (1 - (c as number)) * (1 - (i as number)) * (1 - (a as number))
  const impact = scope === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
  if (impact <= 0) return 0
  const exploitability = 8.22 * (av as number) * (ac as number) * (pr as number) * (ui as number)
  return scope === 'U' ? roundUp(Math.min(impact + exploitability, 10)) : roundUp(Math.min(1.08 * (impact + exploitability), 10))
}

// CVSS's bands: 9.0 critical, 7.0 high, 4.0 moderate, above 0 low.
export function severityOfScore(score: number): Severity {
  return score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'moderate' : score > 0 ? 'low' : 'unknown'
}

type Advisory = {
  id?: unknown
  aliases?: unknown
  summary?: unknown
  details?: unknown
  database_specific?: { severity?: unknown }
  severity?: { type?: unknown; score?: unknown }[]
  affected?: { package?: { name?: unknown; ecosystem?: unknown }; ranges?: { events?: Record<string, unknown>[] }[]; database_specific?: { severity?: unknown }; ecosystem_specific?: { severity?: unknown } }[]
}

// The advisory's own rating (GitHub's CRITICAL, HIGH, MODERATE, LOW),
// else its CVSS v3 vector's score.
export function severityOf(advisory: Advisory): Severity {
  const named = [advisory.database_specific?.severity, ...(advisory.affected ?? []).flatMap(a => [a.database_specific?.severity, a.ecosystem_specific?.severity])]
    .find(s => typeof s === 'string') as string | undefined
  const word = named?.toLowerCase()
  if (word === 'critical') return 'critical'
  if (word === 'high') return 'high'
  if (word === 'moderate' || word === 'medium') return 'moderate'
  if (word === 'low') return 'low'
  for (const s of advisory.severity ?? []) {
    const score = typeof s.score === 'string' ? cvss3Score(s.score) : undefined
    if (score !== undefined) return severityOfScore(score)
  }
  return 'unknown'
}

function sameName(ecosystem: Ecosystem, a: string, b: string): boolean {
  const norm = (s: string) => (ecosystem === 'pypi' ? s.toLowerCase().replace(/[-_.]+/g, '-') : ecosystem === 'nuget' ? s.toLowerCase() : s)
  return norm(a) === norm(b)
}

// The lowest version that fixes the advisory past the installed one, from
// its affected ranges for this package.
export function fixedFor(advisory: Advisory, pkg: Package): string | undefined {
  const installed = parseVersion(pkg.version)
  const name = osvName(pkg.ecosystem, pkg.name)
  const fixes: string[] = []
  for (const a of advisory.affected ?? []) {
    if (typeof a.package?.name !== 'string' || !sameName(pkg.ecosystem, a.package.name, name)) continue
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (typeof e.fixed === 'string') fixes.push(e.fixed.replace(/^v/, ''))
  }
  const above = fixes
    .map(f => ({ f, v: parseVersion(f) }))
    .filter(x => x.v && (!installed || compare(x.v, installed) > 0))
    .sort((x, y) => compare(x.v as never, y.v as never))
  return above[0]?.f ?? (installed ? undefined : fixes[0])
}

export function vulnOf(advisory: Advisory, pkg: Package): Vuln {
  const id = typeof advisory.id === 'string' ? advisory.id : 'unknown'
  const aliases = Array.isArray(advisory.aliases) ? advisory.aliases.filter((a): a is string => typeof a === 'string') : []
  const raw = typeof advisory.summary === 'string' && advisory.summary.trim() ? advisory.summary : typeof advisory.details === 'string' ? advisory.details.split('\n')[0] ?? '' : ''
  const vuln: Vuln = { id, aliases, summary: raw.trim().slice(0, 300), severity: severityOf(advisory) }
  const fixed = fixedFor(advisory, pkg)
  if (fixed) vuln.fixed = fixed
  return vuln
}

export const SEVERITIES: Severity[] = ['critical', 'high', 'moderate', 'low', 'unknown']

// Advisories that are one issue under two ids (GHSA-x and PYSEC-y that
// alias each other) count once, the GHSA kept for its rating.
export function mergeVulns(vulns: Vuln[]): Vuln[] {
  const out: Vuln[] = []
  for (const v of [...vulns].sort((a, b) => Number(b.id.startsWith('GHSA-')) - Number(a.id.startsWith('GHSA-')))) {
    const names = new Set([v.id, ...v.aliases])
    const twin = out.find(o => names.has(o.id) || o.aliases.some(a => names.has(a)))
    if (!twin) {
      out.push(v)
      continue
    }
    if (twin.severity === 'unknown' && v.severity !== 'unknown') twin.severity = v.severity
    if (!twin.fixed && v.fixed) twin.fixed = v.fixed
  }
  return out.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id))
}

export function worstOf(vulns: Vuln[]): Severity {
  return SEVERITIES.find(s => vulns.some(v => v.severity === s)) ?? 'unknown'
}

export function vulnUrl(id: string): string {
  return `https://osv.dev/vulnerability/${id}`
}

// Each (package, vulnerability) of one severity, worst package first.
export function bySeverity(findings: Finding[], severity: Severity): { finding: Finding; vuln: Vuln }[] {
  return findings.flatMap(finding => finding.vulns.filter(v => v.severity === severity).map(vuln => ({ finding, vuln })))
}

export const SEVERITY_TITLE: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  moderate: 'Moderada',
  low: 'Baja',
  unknown: 'Sin clasificar',
}

// What a press on a vulnerability puts on the clipboard: the package, the
// advisory and its gravity, the fix and the link, ready to paste into an issue
// or a prompt.
export function vulnCopyText(finding: Finding, vuln: Vuln): string {
  const where = `${finding.display ?? finding.name} ${finding.version}${finding.isDirect ? '' : ' (indirecta)'}`
  const fix = vuln.fixed ? ` Se corrige en ${vuln.fixed}.` : ' Sin versión que la corrija.'
  return `${where} · ${vuln.id} (${SEVERITY_TITLE[vuln.severity].toLowerCase()}): ${vuln.summary}.${fix} ${vulnUrl(vuln.id)}`
}

// How many of a package's vulnerabilities its upgrade to `latest` fixes.
export function fixedBy(finding: Finding | undefined, latest: string): number {
  const target = parseVersion(latest)
  if (!finding || !target) return 0
  return finding.vulns.filter(v => {
    const fix = v.fixed ? parseVersion(v.fixed) : undefined
    return fix !== undefined && compare(target, fix) >= 0
  }).length
}

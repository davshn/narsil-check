// Version arithmetic shared by every ecosystem: parsing, comparing, the kind
// of jump between two versions and whether a version meets a range.
// Pure functions over plain values: the hooks module fetches and draws.

export type Version = { major: number; minor: number; patch: number; pre: string }

// How far apart two versions are, which is the first guess at how hard the
// upgrade is: a patch or a minor is usually a bump, a major needs reading.
export type Bump = 'none' | 'patch' | 'minor' | 'major'

const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(text: string): Version | undefined {
  const m = VERSION.exec(text.trim())
  if (!m) return undefined
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), pre: m[4] ?? '' }
}

export function compare(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  // A prerelease comes before its release.
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  return a.pre < b.pre ? -1 : 1
}

// Below 1.0.0 a minor is a breaking change (0.3 -> 0.4) and below 0.1.0 so is
// a patch, as npm's caret ranges treat them.
export function bumpOf(from: Version, to: Version): Bump {
  if (compare(to, from) <= 0) return 'none'
  if (to.major !== from.major) return 'major'
  if (to.minor !== from.minor) return from.major === 0 ? 'major' : 'minor'
  if (to.patch !== from.patch) return from.major === 0 && from.minor === 0 ? 'major' : 'patch'
  return 'patch'
}

// The version a range is written from: "^1.2.3" -> 1.2.3. Undefined for what
// names no version (a tag, a path, a git or workspace link, "*").
export function baseOf(spec: string): Version | undefined {
  const s = spec.trim()
  if (/^(workspace|file|link|git|git\+\w+|https?|npm|github):/.test(s) || s.includes('/')) return undefined
  const first = s.split(/\s*\|\|\s*/)[0]?.split(/\s+/)[0] ?? ''
  return parseVersion(first.replace(/^(\^|~|>=|<=|>|<|=)/, ''))
}

// Whether `version` meets `range`, as npm reads ranges: sets joined by ||,
// each a list of comparators that must all hold (">=4.8.4 <6.1.0"), with ^,
// ~, <, <=, >, >=, =, hyphen ranges ("1 - 2"), partial versions ("^9",
// "9.x", "9") and "*". A comparator it cannot read is taken as met, so an
// unknown range never raises a false alarm.
export function satisfies(version: Version, range: string): boolean {
  const sets = range.trim() === '' ? ['*'] : range.split(/\s*\|\|\s*/)
  return sets.some(set => comparators(set).every(c => meets(version, c)))
}

type Partial = { major?: number; minor?: number; patch?: number; pre: string }

function partial(text: string): Partial | undefined {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (!m) return undefined
  const num = (s: string | undefined) => (s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s))
  const major = num(m[1])
  const minor = major === undefined ? undefined : num(m[2])
  const patch = minor === undefined ? undefined : num(m[3])
  return { major, minor, patch, pre: m[4] ?? '' }
}

const full = (p: Partial): Version => ({ major: p.major ?? 0, minor: p.minor ?? 0, patch: p.patch ?? 0, pre: p.pre })

// The comparators of one set, a hyphen range spelled as two.
function comparators(set: string): string[] {
  const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(set)
  if (hyphen) return [`>=${hyphen[1]}`, `<=${hyphen[2]}`]
  // ">= 1.2" is ">=1.2": an operator may stand apart from its version.
  return set.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean)
}

// The version just past a partial one: "9" -> 10.0.0, "9.2" -> 9.3.0.
function above(p: Partial): Version | undefined {
  if (p.major === undefined) return undefined
  if (p.minor === undefined) return { major: p.major + 1, minor: 0, patch: 0, pre: '' }
  if (p.patch === undefined) return { major: p.major, minor: p.minor + 1, patch: 0, pre: '' }
  return undefined
}

function meets(v: Version, comparator: string): boolean {
  const op = /^(\^|~|>=|<=|>|<|=)?/.exec(comparator)?.[1] ?? ''
  const p = partial(comparator.slice(op.length))
  if (!p) return true
  if (p.major === undefined) return true
  const base = full(p)
  const atLeast = compare(v, base) >= 0
  switch (op) {
    case '>=':
      return atLeast
    case '>':
      // ">9" means past every 9.x.
      return above(p) ? compare(v, above(p) as Version) >= 0 : compare(v, base) > 0
    case '<':
      return compare(v, base) < 0
    case '<=': {
      const next = above(p)
      return next ? compare(v, next) < 0 : compare(v, base) <= 0
    }
    case '~': {
      const end = p.minor === undefined ? { major: base.major + 1, minor: 0, patch: 0, pre: '' } : { major: base.major, minor: base.minor + 1, patch: 0, pre: '' }
      return atLeast && compare(v, end) < 0
    }
    case '^': {
      if (!atLeast) return false
      if (base.major > 0 || p.minor === undefined) return v.major === base.major
      if (base.minor > 0 || p.patch === undefined) return v.major === 0 && v.minor === base.minor
      return v.major === 0 && v.minor === 0 && v.patch === base.patch
    }
    default: {
      // A bare or "=" partial version is the range it spells: "9" is 9.x.
      const next = above(p)
      return next ? atLeast && compare(v, next) < 0 : compare(v, base) === 0
    }
  }
}

export function show(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ''}`
}

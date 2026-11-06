// C#, F# and VB on NuGet: the PackageReference items of every project file
// and the PackageVersion items of central package management
// (Directory.Packages.props), api.nuget.org's latest stable release, and
// the files rewritten in place for the bump group.

import type { Upgrade } from '../types'
import type { Adapter, Dep, Files } from './adapter'
import { escapeRegex } from './adapter'
import { compare, parseVersion } from './semver'
import type { Version } from './semver'

const CENTRAL = 'Directory.Packages.props'
const GLOBS = ['**/*.csproj', '**/*.fsproj', '**/*.vbproj', `**/${CENTRAL}`]

function attr(element: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(element)?.[1]
}

// Each <PackageReference> and <PackageVersion> with a literal version, its
// version an attribute or a child element. A version from an MSBuild
// property ($(X)), a range ([1.0,2.0)) or a centrally managed reference
// with none is left out: there is nothing literal to raise.
export function parseProject(text: string, path: string): Dep[] {
  const deps: Dep[] = []
  for (const m of text.matchAll(/<(PackageReference|PackageVersion)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi)) {
    const head = m[2] as string
    const body = m[3] ?? ''
    const id = attr(head, 'Include') ?? attr(head, 'Update')
    const version = attr(head, 'Version') ?? /<Version>\s*([^<]+?)\s*<\/Version>/i.exec(body)?.[1]
    if (!id || !version || !/^\d/.test(version)) continue
    // An analyzer or build tool kept out of the package's consumers.
    const isDev = /^all$/i.test(attr(head, 'PrivateAssets') ?? /<PrivateAssets>\s*([^<]+?)\s*<\/PrivateAssets>/i.exec(body)?.[1] ?? '')
    deps.push({ name: id, spec: version, isDev, installed: version, source: `file:${path}` })
  }
  return deps
}

export function parseNuget(files: Files): Dep[] {
  const deps: Dep[] = []
  for (const [path, text] of Object.entries(files)) {
    if (!/\.(cs|fs|vb)proj$/i.test(path) && !path.endsWith(CENTRAL)) continue
    for (const d of parseProject(text, path)) if (!deps.some(e => e.name.toLowerCase() === d.name.toLowerCase() && e.spec === d.spec)) deps.push(d)
  }
  return deps
}

// The highest stable version the flat container lists: NuGet marks every
// prerelease with a dash (14.0.1-beta2).
export function latestNuget(text: string): string | undefined {
  const versions = (JSON.parse(text) as { versions?: unknown }).versions
  let best: { text: string; v: Version } | undefined
  for (const item of Array.isArray(versions) ? versions : []) {
    if (typeof item !== 'string' || item.includes('-')) continue
    const v = parseVersion(item)
    if (v && (!best || compare(v, best.v) > 0)) best = { text: item, v }
  }
  return best?.text
}

// A project file with each upgrade's version raised in its own element,
// every other byte as it was.
export function rewriteProject(text: string, upgrades: Upgrade[]): string {
  return text.replace(/<(PackageReference|PackageVersion)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi, (element: string, _kind: string, head: string) => {
    const id = attr(head, 'Include') ?? attr(head, 'Update')
    const u = upgrades.find(x => id !== undefined && x.name.toLowerCase() === id.toLowerCase())
    if (!u) return element
    const old = escapeRegex(u.spec)
    return element
      .replace(new RegExp(`(\\bVersion\\s*=\\s*")${old}(")`, 'i'), `$1${u.latest}$2`)
      .replace(new RegExp(`(<Version>\\s*)${old}(\\s*</Version>)`, 'i'), `$1${u.latest}$2`)
  })
}

export const NUGET: Adapter = {
  id: 'nuget',
  label: 'NuGet',
  manifests: [CENTRAL],
  globs: GLOBS,
  lockfiles: [],
  parse: parseNuget,
  latestUrl: name => `https://api.nuget.org/v3-flatcontainer/${name.toLowerCase()}/index.json`,
  releasedUrls: (name, version) => [`https://api.nuget.org/v3/registration5-semver1/${name.toLowerCase()}/${version.toLowerCase()}.json`],
  releasedOf: text => {
    const at = (JSON.parse(text) as { published?: unknown }).published
    return typeof at === 'string' ? at : undefined
  },
  latestOf: latestNuget,
  rewrite: (files, upgrades) => {
    const out: Files = {}
    for (const path of new Set(upgrades.map(u => (u.source ?? '').replace(/^file:/, '')))) {
      const text = files[path]
      if (text !== undefined) out[path] = rewriteProject(text, upgrades.filter(u => u.source === `file:${path}`))
    }
    return out
  },
  installArgv: () => [['dotnet', 'restore']],
  managerOf: () => 'dotnet',
  // A package's namespace is its id most of the time: using Newtonsoft.Json;
  importPattern: name => `^[[:space:]]*(global[[:space:]]+)?using[[:space:]]+(static[[:space:]]+)?${escapeRegex(name)}([.;[:space:]]|$)`,
  infoUrl: (name, latest) => `https://api.nuget.org/v3-flatcontainer/${name.toLowerCase()}/${latest.toLowerCase()}/${name.toLowerCase()}.nuspec`,
  repoUrlOf: nuspec => {
    const url = /<repository\b[^>]*\burl="([^"]+)"/.exec(nuspec)?.[1] ?? /<projectUrl>\s*([^<]+?)\s*<\/projectUrl>/.exec(nuspec)?.[1]
    return url && url.includes('github.com') ? url : undefined
  },
}

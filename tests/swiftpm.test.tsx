import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { SWIFTPM, anyCase, canonicalUrl, latestTag, minimumOf, moduleOf, parsePackageSwift, parsePbxproj, parseSwiftpm, resolvedVersions, rewriteSwift } from '../hooks/swiftpm'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Shaped after vapor's Package.swift: every requirement form, a traits
// argument, a branch and a local path.
const PACKAGE_SWIFT = `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "demo",
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.101.3"),
        .package(url: "https://github.com/apple/swift-argument-parser", .upToNextMajor(from: "1.2.0")),
        .package(url: "https://github.com/apple/swift-log.git", .upToNextMinor(from: "1.5.0")),
        .package(url: "https://github.com/Alamofire/Alamofire.git", exact: "5.8.1"),
        .package(url: "https://github.com/apple/swift-configuration.git", from: "1.0.0", traits: ["CommandLineArguments"]),
        .package(url: "https://github.com/apple/swift-collections", "1.0.0"..<"2.0.0"),
        .package(url: "https://github.com/o/edge.git", branch: "main"),
        .package(path: "../Local"),
    ]
)
`

const RESOLVED_V2 = JSON.stringify({
  pins: [
    { identity: 'swift-nio', kind: 'remoteSourceControl', location: 'https://github.com/apple/swift-nio.git', state: { revision: 'a', version: '2.101.3' } },
    { identity: 'swift-argument-parser', kind: 'remoteSourceControl', location: 'https://github.com/apple/swift-argument-parser', state: { revision: 'b', version: '1.3.0' } },
    { identity: 'swift-log', kind: 'remoteSourceControl', location: 'https://github.com/apple/swift-log.git', state: { revision: 'c', version: '1.5.4' } },
    { identity: 'alamofire', kind: 'remoteSourceControl', location: 'https://github.com/Alamofire/Alamofire.git', state: { revision: 'd', version: '5.8.1' } },
  ],
  version: 2,
})

const RESOLVED_V1 = JSON.stringify({
  object: { pins: [{ package: 'Kingfisher', repositoryURL: 'https://github.com/onevcat/Kingfisher.git', state: { branch: null, revision: 'e', version: '7.10.0' } }] },
  version: 1,
})

const PBXPROJ = `// !$*UTF8*$!
{
	objects = {
/* Begin XCRemoteSwiftPackageReference section */
		A1 /* XCRemoteSwiftPackageReference "Kingfisher" */ = {
			isa = XCRemoteSwiftPackageReference;
			repositoryURL = "https://github.com/onevcat/Kingfisher.git";
			requirement = {
				kind = upToNextMajorVersion;
				minimumVersion = 7.10.0;
			};
		};
		A2 /* XCRemoteSwiftPackageReference "Edge" */ = {
			isa = XCRemoteSwiftPackageReference;
			repositoryURL = "https://github.com/o/edge";
			requirement = {
				branch = main;
				kind = branch;
			};
		};
/* End XCRemoteSwiftPackageReference section */
	};
}
`

test('a package URL is one name however it is spelled', () => {
  expect(canonicalUrl('https://GitHub.com/Alamofire/Alamofire.git')).toBe('https://github.com/Alamofire/Alamofire')
  expect(canonicalUrl('https://github.com/apple/swift-nio/')).toBe('https://github.com/apple/swift-nio')
})

test('every requirement form gives its lowest version; a branch or a path none', () => {
  expect(minimumOf('url: "x", from: "2.101.3"')).toBe('2.101.3')
  expect(minimumOf('url: "x", .upToNextMajor(from: "1.2.0")')).toBe('1.2.0')
  expect(minimumOf('url: "x", exact: "5.8.1"')).toBe('5.8.1')
  expect(minimumOf('url: "x", .exact("5.8.1")')).toBe('5.8.1')
  expect(minimumOf('url: "x", "1.0.0"..<"2.0.0"')).toBe('1.0.0')
  expect(minimumOf('url: "x", "1.0.0"..."1.9.0"')).toBe('1.0.0')
  expect(minimumOf('url: "x", branch: "main"')).toBeUndefined()
})

test('Package.swift and Package.resolved give each package and the version pinned', () => {
  expect(parsePackageSwift(PACKAGE_SWIFT, 'Package.swift').map(d => `${d.display}@${d.spec}`)).toEqual([
    'swift-nio@2.101.3',
    'swift-argument-parser@1.2.0',
    'swift-log@1.5.0',
    'Alamofire@5.8.1',
    'swift-configuration@1.0.0',
    'swift-collections@1.0.0',
  ])
  const deps = parseSwiftpm({ 'Package.swift': PACKAGE_SWIFT, 'Package.resolved': RESOLVED_V2 })
  expect(deps.find(d => d.display === 'swift-argument-parser')).toEqual({
    name: 'https://github.com/apple/swift-argument-parser',
    spec: '1.2.0',
    isDev: false,
    installed: '1.3.0',
    display: 'swift-argument-parser',
    source: 'file:Package.swift',
  })
  // Not pinned: the requirement's own version.
  expect(deps.find(d => d.display === 'swift-collections')?.installed).toBe('1.0.0')
})

test("an Xcode app's project and its workspace's Package.resolved (version 1) are read too", () => {
  expect(parsePbxproj(PBXPROJ, 'App.xcodeproj/project.pbxproj')).toEqual([
    { name: 'https://github.com/onevcat/Kingfisher', spec: '7.10.0', isDev: false, display: 'Kingfisher', source: 'file:App.xcodeproj/project.pbxproj' },
  ])
  expect([...resolvedVersions(RESOLVED_V1)]).toEqual([['https://github.com/onevcat/Kingfisher', '7.10.0']])
  const deps = parseSwiftpm({
    'App.xcodeproj/project.pbxproj': PBXPROJ,
    'App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved': RESOLVED_V1,
  })
  expect(deps.map(d => `${d.display}@${d.installed}`)).toEqual(['Kingfisher@7.10.0'])
})

test('the latest is the highest plain release tag, without its v', () => {
  const lsRemote = ['a\trefs/tags/1.8.0', 'b\trefs/tags/v1.8.2', 'c\trefs/tags/2.0.0-beta.1', 'd\trefs/tags/1.10.0', 'e\trefs/tags/nightly'].join('\n')
  expect(latestTag(lsRemote)).toBe('1.10.0')
  expect(latestTag('')).toBeUndefined()
  expect(SWIFTPM.latestCommand?.('https://github.com/apple/swift-nio')).toEqual(['git', 'ls-remote', '--tags', '--refs', 'https://github.com/apple/swift-nio'])
  expect(SWIFTPM.repoUrlFor?.('https://github.com/apple/swift-nio')).toBe('https://github.com/apple/swift-nio')
})

test('the import pattern matches the module whatever its capitals', () => {
  expect(moduleOf('https://github.com/apple/swift-nio-ssl')).toBe('niossl')
  expect(anyCase('nio')).toBe('[Nn][Ii][Oo]')
  expect(SWIFTPM.importPattern('https://github.com/apple/swift-argument-parser')).toBe(
    '^[[:space:]]*(@testable[[:space:]]+)?import[[:space:]]+[Aa][Rr][Gg][Uu][Mm][Ee][Nn][Tt][Pp][Aa][Rr][Ss][Ee][Rr]([[:space:]]|$)',
  )
})

test('raising minimums inside each package declaration leaves every other byte as it was', () => {
  const up = (url: string, spec: string, latest: string) =>
    ({ name: url, ecosystem: 'swiftpm', spec, current: spec, latest, bump: 'minor', isDev: false, group: 'bump', conflicts: [] as string[] }) as const
  const ups = [
    up('https://github.com/apple/swift-nio', '2.101.3', '2.105.0'),
    up('https://github.com/apple/swift-argument-parser', '1.2.0', '1.8.2'),
    up('https://github.com/apple/swift-collections', '1.0.0', '1.7.5'),
    up('https://github.com/onevcat/Kingfisher', '7.10.0', '7.12.0'),
  ]
  expect(rewriteSwift(PACKAGE_SWIFT, ups)).toBe(
    PACKAGE_SWIFT.replace('from: "2.101.3"', 'from: "2.105.0"').replace('.upToNextMajor(from: "1.2.0")', '.upToNextMajor(from: "1.8.2")').replace('"1.0.0"..<"2.0.0"', '"1.7.5"..<"2.0.0"'),
  )
  // swift-configuration also starts at 1.0.0, but it is not upgraded.
  expect(rewriteSwift(PACKAGE_SWIFT, ups)).toContain('swift-configuration.git", from: "1.0.0"')
  expect(rewriteSwift(PBXPROJ, ups)).toBe(PBXPROJ.replace('minimumVersion = 7.10.0;', 'minimumVersion = 7.12.0;'))
})

function swiftPackage(on: On, tags: Record<string, string[]>) {
  const files: Record<string, string> = { 'Package.swift': PACKAGE_SWIFT, 'Package.resolved': RESOLVED_V2 }
  const store = new Map<string, unknown>()
  const keyOf = (path: string) => {
    const at = path.replace(/\\/g, '/')
    return Object.keys(files).find(name => at === name || at.endsWith(`/${name}`))
  }
  on('fs.exists', (_, e) => ({ value: keyOf(e.path) !== undefined }))
  on('fs.read', (_, e) => {
    const key = keyOf(e.path)
    if (key === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: files[key] as string }
  })
  on('fs.write', (_, e) => {
    files[keyOf(e.path) ?? e.path] = e.text
    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'upgrades' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const ran: string[][] = []
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const done = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    // git ls-remote answers each package's tags; no other git repository.
    if (e.argv[1] === 'ls-remote') return done((tags[e.argv[4] as string] ?? []).map((t, i) => `${i}\trefs/tags/${t}`).join('\n'))
    if (e.argv[1] === 'ls-files') return done('')
    return done('', e.argv[0] === 'git' ? 1 : 0)
  })
  return { files, ran }
}

async function scanned($: Engine) {
  for (let i = 0; i < 100; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const scanning = await ui.find({ type: 'Text', text: /Buscando/ })
    await ui.unmount()
    if (!scanning) return
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
}

test('a Swift package reads tags with git ls-remote and the button raises Package.swift and runs swift package update', async ($, on) => {
  const { files, ran } = swiftPackage(on, {
    'https://github.com/apple/swift-nio': ['2.101.3', '2.105.0'],
    'https://github.com/apple/swift-argument-parser': ['1.3.0', 'v1.8.2'],
    'https://github.com/apple/swift-log': ['1.5.4'],
    'https://github.com/Alamofire/Alamofire': ['5.8.1', '6.0.0-beta.1', '5.12.2'],
    'https://github.com/apple/swift-configuration': ['1.0.0'],
    'https://github.com/apple/swift-collections': ['1.0.0', '2.0.0'],
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('4 para actualizar de 6 · 1 mayores · 3 triviales')
  expect((await ui.find({ type: 'Button', text: /^swift-argument-parser/ }))?.text).toBe('swift-argument-parser 1.3.0 → 1.8.2')
  // An exact pin with a newer release is still listed: raising it is the upgrade.
  expect((await ui.find({ type: 'Button', text: /^Alamofire/ }))?.text).toBe('Alamofire 5.8.1 → 5.12.2')
  expect(ran.filter(argv => argv[1] === 'ls-remote').length).toBe(6)

  await ui.press({ key: 'upgrade-bumps' })
  expect(ran.filter(argv => argv[0] === 'swift')).toEqual([['swift', 'package', 'update', 'alamofire', 'swift-argument-parser', 'swift-nio']])
  expect(files['Package.swift']).toContain('swift-nio.git", from: "2.105.0"')
  expect(files['Package.swift']).toContain('exact: "5.12.2"')
  // The major is left for the person.
  expect(files['Package.swift']).toContain('"1.0.0"..<"2.0.0"')
  await ui.unmount()
})

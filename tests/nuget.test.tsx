import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { NUGET, latestNuget, parseNuget, parseProject, rewriteProject } from '../hooks/nuget'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const API = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />
    <PackageReference Version="3.0.0" Include="Serilog" />
    <PackageReference Include="Dapper">
      <Version>2.1.28</Version>
    </PackageReference>
    <PackageReference Include="StyleCop.Analyzers" Version="1.1.118">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
    <PackageReference Include="FromProperty" Version="$(SharedVersion)" />
    <PackageReference Include="Ranged" Version="[1.0,2.0)" />
    <PackageReference Include="Centrally.Managed" />
  </ItemGroup>
</Project>
`

const CENTRAL = `<Project>
  <ItemGroup>
    <PackageVersion Include="Centrally.Managed" Version="5.0.0" />
  </ItemGroup>
</Project>
`

test('project files give each literal package version, analyzers as development ones', () => {
  expect(parseProject(API, 'src/Api/Api.csproj')).toEqual([
    { name: 'Newtonsoft.Json', spec: '13.0.1', isDev: false, installed: '13.0.1', source: 'file:src/Api/Api.csproj' },
    { name: 'Serilog', spec: '3.0.0', isDev: false, installed: '3.0.0', source: 'file:src/Api/Api.csproj' },
    { name: 'Dapper', spec: '2.1.28', isDev: false, installed: '2.1.28', source: 'file:src/Api/Api.csproj' },
    { name: 'StyleCop.Analyzers', spec: '1.1.118', isDev: true, installed: '1.1.118', source: 'file:src/Api/Api.csproj' },
  ])
  // Central package management: the version lives in Directory.Packages.props.
  expect(parseNuget({ 'src/Api/Api.csproj': API, 'Directory.Packages.props': CENTRAL }).map(d => `${d.name}@${d.spec}`)).toEqual([
    'Newtonsoft.Json@13.0.1',
    'Serilog@3.0.0',
    'Dapper@2.1.28',
    'StyleCop.Analyzers@1.1.118',
    'Centrally.Managed@5.0.0',
  ])
})

test('the latest is the highest version with no prerelease dash', () => {
  expect(latestNuget(JSON.stringify({ versions: ['13.0.1', '13.0.3', '13.0.4', '13.0.5-beta1', '14.0.1-beta2'] }))).toBe('13.0.4')
  expect(latestNuget(JSON.stringify({ versions: ['4.0.0.1', '4.0.0.12', '4.0.0.3'] }))).toBe('4.0.0.12')
  expect(NUGET.latestUrl('Newtonsoft.Json')).toBe('https://api.nuget.org/v3-flatcontainer/newtonsoft.json/index.json')
  expect(NUGET.infoUrl?.('Newtonsoft.Json', '13.0.4')).toBe('https://api.nuget.org/v3-flatcontainer/newtonsoft.json/13.0.4/newtonsoft.json.nuspec')
  expect(NUGET.repoUrlOf('<package><metadata><repository type="git" url="https://github.com/JamesNK/Newtonsoft.Json" /></metadata></package>')).toBe('https://github.com/JamesNK/Newtonsoft.Json')
  expect(NUGET.importPattern('Newtonsoft.Json')).toBe('^[[:space:]]*(global[[:space:]]+)?using[[:space:]]+(static[[:space:]]+)?Newtonsoft\\.Json([.;[:space:]]|$)')
})

test('raising versions in a project file leaves every other byte as it was', () => {
  const up = (name: string, spec: string, latest: string) =>
    ({ name, ecosystem: 'nuget', spec, current: spec, latest, bump: 'minor', isDev: false, group: 'bump', conflicts: [] as string[] }) as const
  expect(rewriteProject(API, [up('newtonsoft.json', '13.0.1', '13.0.4'), up('Serilog', '3.0.0', '3.1.1'), up('Dapper', '2.1.28', '2.1.66')])).toBe(
    API.replace('Version="13.0.1"', 'Version="13.0.4"').replace('Version="3.0.0"', 'Version="3.1.1"').replace('<Version>2.1.28</Version>', '<Version>2.1.66</Version>'),
  )
})

function dotnetProject(on: On, latest: Record<string, string[]>) {
  const files: Record<string, string> = { 'src/Api/Api.csproj': API }
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
  on('http.fetch', (_, e) => {
    const id = /v3-flatcontainer\/([^/]+)\/index\.json$/.exec(e.url)?.[1] ?? ''
    const versions = latest[id]
    return {
      value: versions
        ? { status: 200, ok: true, headers: {}, text: JSON.stringify({ versions }) }
        : { status: 404, ok: false, headers: {}, text: '' },
    }
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
    // git ls-files finds the project file under src/.
    const ls = e.argv[1] === 'ls-files'
    return { value: { exitCode: ls || e.argv[0] !== 'git' ? 0 : 1, stdout: ls ? 'src/Api/Api.csproj\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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

test('a .NET project found under src/ lists its packages and the button raises the csproj and runs dotnet restore', async ($, on) => {
  const { files, ran } = dotnetProject(on, {
    'newtonsoft.json': ['13.0.1', '13.0.4', '14.0.1-beta2'],
    serilog: ['3.0.0', '3.1.1', '4.4.0'],
    dapper: ['2.1.28', '2.1.66'],
    'stylecop.analyzers': ['1.1.118', '1.2.0-beta.556'],
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('3 para actualizar de 4 · 1 mayores · 2 triviales')
  expect((await ui.find({ type: 'Text', text: /^Serilog/ }))?.text).toBe('Serilog 3.0.0 → 4.4.0')

  await ui.press({ key: 'upgrade-bumps' })
  expect(ran.filter(argv => argv[0] === 'dotnet')).toEqual([['dotnet', 'restore']])
  expect(files['src/Api/Api.csproj']).toContain('<PackageReference Include="Newtonsoft.Json" Version="13.0.4" />')
  expect(files['src/Api/Api.csproj']).toContain('<Version>2.1.66</Version>')
  expect(files['src/Api/Api.csproj']).toContain('<PackageReference Version="3.0.0" Include="Serilog" />')
  await ui.unmount()
})

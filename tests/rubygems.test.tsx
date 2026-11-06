import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { RUBYGEMS, gemSpecFor, lockVersion, parseGemLine, parseGemfile, rewriteGemfile } from '../hooks/rubygems'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const GEMFILE = `source "https://rubygems.org"

ruby "3.3.0"

gem "rails", "~> 7.1.3" # the framework
gem 'pg', '>= 1.1', '< 2'
gem "puma"
gem "nokogiri", "~> 1.16.0"
gem "internal", git: "https://github.com/o/internal"
gem "local_engine", path: "engines/local"

group :development, :test do
  gem "rspec-rails", "~> 6.1.0"
  platforms :mri do
    gem "debug", ">= 1.0.0"
  end
end

gem "rubocop", "~> 1.60", require: false, group: :development
`

const LOCK = `GEM
  remote: https://rubygems.org/
  specs:
    actionpack (7.1.3)
      rack (>= 2.2.4)
    debug (1.9.1)
    nokogiri (1.16.0-x86_64-linux)
      racc (~> 1.4)
    pg (1.5.4)
    puma (6.4.2)
    rails (7.1.3)
    rspec-rails (6.1.0)
    rubocop (1.60.2)

PLATFORMS
  x86_64-linux

DEPENDENCIES
  rails (~> 7.1.3)
`

test('a gem line gives its name and requirements; a git or path gem is left out', () => {
  expect(parseGemLine('gem "rails", "~> 7.1.3" # the framework')).toEqual({ name: 'rails', spec: '~> 7.1.3', isDev: false })
  expect(parseGemLine("gem 'pg', '>= 1.1', '< 2'")).toEqual({ name: 'pg', spec: '>= 1.1, < 2', isDev: false })
  expect(parseGemLine('gem "rubocop", "~> 1.60", require: false, group: :development')).toEqual({ name: 'rubocop', spec: '~> 1.60', isDev: true })
  expect(parseGemLine('gem "internal", git: "https://github.com/o/internal"')).toBeUndefined()
  expect(parseGemLine('source "https://rubygems.org"')).toBeUndefined()
  expect(lockVersion('1.16.0-x86_64-linux')).toBe('1.16.0')
  expect(lockVersion('8.1.4.1')).toBe('8.1.4.1')
})

test('the Gemfile and its lock give each gem, its group and the installed version', () => {
  expect(parseGemfile({ Gemfile: GEMFILE, 'Gemfile.lock': LOCK })).toEqual([
    { name: 'rails', spec: '~> 7.1.3', isDev: false, installed: '7.1.3' },
    { name: 'pg', spec: '>= 1.1, < 2', isDev: false, installed: '1.5.4' },
    { name: 'puma', spec: '', isDev: false, installed: '6.4.2' },
    { name: 'nokogiri', spec: '~> 1.16.0', isDev: false, installed: '1.16.0' },
    { name: 'rspec-rails', spec: '~> 6.1.0', isDev: true, installed: '6.1.0' },
    // A platforms block inside a development group is still development.
    { name: 'debug', spec: '>= 1.0.0', isDev: true, installed: '1.9.1' },
    // After the group's end, back to the default group, but this line names its own.
    { name: 'rubocop', spec: '~> 1.60', isDev: true, installed: '1.60.2' },
  ])
})

test('raising a requirement keeps its operator, its upper bound and every other byte', () => {
  expect(gemSpecFor('~> 7.1.3', '7.1.5.2')).toBe('~> 7.1.5.2')
  expect(gemSpecFor('>= 1.1', '1.6.0')).toBe('>= 1.6.0')
  const up = (name: string, latest: string) =>
    ({ name, ecosystem: 'rubygems', spec: '', current: '', latest, bump: 'minor', isDev: false, group: 'bump', conflicts: [] as string[] }) as const
  expect(rewriteGemfile(GEMFILE, [up('rails', '7.1.5.2'), up('pg', '1.6.0'), up('puma', '6.6.0'), up('rubocop', '1.81.0')])).toBe(
    GEMFILE.replace('"~> 7.1.3"', '"~> 7.1.5.2"').replace("'>= 1.1'", "'>= 1.6.0'").replace('"~> 1.60"', '"~> 1.81.0"'),
  )
})

test("rubygems.org's answers give the latest release, never a prerelease, and the repository", () => {
  expect(RUBYGEMS.latestOf(JSON.stringify({ version: '8.1.4.1' }))).toBe('8.1.4.1')
  expect(RUBYGEMS.latestOf(JSON.stringify({ version: '8.2.0.beta1' }))).toBeUndefined()
  expect(RUBYGEMS.repoUrlOf(JSON.stringify({ source_code_uri: 'https://github.com/rails/rails/tree/v8.1.4.1', homepage_uri: 'https://rubyonrails.org' }))).toBe(
    'https://github.com/rails/rails/tree/v8.1.4.1',
  )
  expect(RUBYGEMS.latestUrl('rspec-rails')).toBe('https://rubygems.org/api/v1/versions/rspec-rails/latest.json')
  expect(RUBYGEMS.infoUrl?.('rails', '8.1.4.1')).toBe('https://rubygems.org/api/v1/gems/rails.json')
})

function rubyApp(on: On, latest: Record<string, string>) {
  const files: Record<string, string> = { Gemfile: GEMFILE, 'Gemfile.lock': LOCK }
  const store = new Map<string, unknown>()
  const keyOf = (path: string) => {
    const at = path.replace(/\\/g, '/')
    return Object.keys(files)
      .sort((a, b) => b.length - a.length)
      .find(name => at === name || at.endsWith(`/${name}`))
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
    const version = latest[decodeURIComponent(/versions\/([^/]+)\/latest\.json$/.exec(e.url)?.[1] ?? '')]
    return {
      value: version
        ? { status: 200, ok: true, headers: {}, text: JSON.stringify({ version }) }
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
    return { value: { exitCode: e.argv[0] === 'git' ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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

test('a Rails app lists its gems and the button raises the Gemfile and runs bundle update --conservative', async ($, on) => {
  const { files, ran } = rubyApp(on, {
    rails: '8.1.4.1',
    pg: '1.6.2',
    puma: '6.6.0',
    nokogiri: '1.16.8',
    'rspec-rails': '6.1.5',
    debug: '1.9.1',
    rubocop: '1.81.0',
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await scanned($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /para actualizar/ }))?.text).toBe('6 para actualizar de 7 · 1 mayores · 5 triviales')
  expect((await ui.find({ type: 'Button', text: /^rails/ }))?.text).toBe('rails 7.1.3 → 8.1.4.1')

  await ui.press({ key: 'upgrade-bumps' })
  expect(ran.filter(argv => argv[0] === 'bundle')).toEqual([['bundle', 'update', '--conservative', 'nokogiri', 'pg', 'puma', 'rspec-rails', 'rubocop']])
  expect(files.Gemfile).toContain(`gem 'pg', '>= 1.6.2', '< 2'`)
  expect(files.Gemfile).toContain('gem "nokogiri", "~> 1.16.8"')
  expect(files.Gemfile).toContain('gem "puma"\n')
  // The major is left for the person.
  expect(files.Gemfile).toContain('gem "rails", "~> 7.1.3" # the framework')
  await ui.unmount()
})

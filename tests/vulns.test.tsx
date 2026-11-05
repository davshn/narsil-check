import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { NPM } from '../hooks/ecosystems'
import { batchBody, batchIds, copyVulnsText, cvss3Score, fixedBy, fixedFor, mergeVulns, osvName, severityOf, vulnOf } from '../hooks/osv'
import type { Package } from '../hooks/osv'
import { auditSummary, vulnsColor, vulnsLabel } from '../hooks/words'
import type { Finding } from '../types'

declare function setTimeout(fn: () => void, ms: number): unknown

const PANE = {
  plugin: 'narsil-check',
  component: 'Pane',
  requestId: 'narsil-check',
  props: { title: 'Narsil Check', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const LODASH: Package = { name: 'lodash', version: '4.17.20', ecosystem: 'npm', isDirect: true }

// Shaped after OSV's records of lodash's advisories.
const REDOS = {
  id: 'GHSA-29mw-wpgm-hmr9',
  aliases: ['CVE-2020-28500'],
  summary: 'Regular Expression Denial of Service (ReDoS) in lodash',
  database_specific: { severity: 'MODERATE' },
  affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '4.0.0' }, { fixed: '4.17.21' }] }] }],
}
const INJECTION = {
  id: 'GHSA-35jh-r3h4-6jhm',
  aliases: ['CVE-2021-23337'],
  summary: 'Command Injection in lodash',
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H' }],
  affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }],
}

test("a CVSS v3 vector's base score is FIRST's", () => {
  expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8)
  expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H')).toBe(7.2)
  expect(cvss3Score('CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N')).toBe(5.3)
  // A changed scope: the classic reflected XSS.
  expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBe(6.1)
  expect(cvss3Score('CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:N')).toBe(0)
  expect(cvss3Score('CVSS:4.0/AV:N/AC:L')).toBeUndefined()
})

test("severity is the advisory's own rating, else its CVSS score's band", () => {
  expect(severityOf(REDOS)).toBe('moderate')
  expect(severityOf(INJECTION)).toBe('high')
  expect(severityOf({ database_specific: { severity: 'CRITICAL' } })).toBe('critical')
  expect(severityOf({})).toBe('unknown')
})

test('the fixing version is the lowest fixed event past the installed one', () => {
  expect(fixedFor(REDOS, LODASH)).toBe('4.17.21')
  const twoLines = { affected: [{ package: { name: 'x', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '1.0.0' }, { fixed: '1.4.2' }, { introduced: '2.0.0' }, { fixed: '2.1.0' }] }] }] }
  expect(fixedFor(twoLines, { name: 'x', version: '2.0.5', ecosystem: 'npm', isDirect: true })).toBe('2.1.0')
  expect(fixedFor({ affected: [{ package: { name: 'x', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '0' }] }] }] }, { name: 'x', version: '1.0.0', ecosystem: 'npm', isDirect: true })).toBeUndefined()
  // A PyPI name matches however it is spelled.
  const py = { affected: [{ package: { name: 'PyYAML', ecosystem: 'PyPI' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '5.4' }] }] }] }
  expect(fixedFor(py, { name: 'pyyaml', version: '5.3.1', ecosystem: 'pypi', isDirect: true })).toBe('5.4')
})

test('one issue under a GHSA and a PYSEC id counts once, the GHSA kept', () => {
  const ghsa = vulnOf({ id: 'GHSA-j8r2-6x86-q33q', aliases: ['CVE-2023-32681', 'PYSEC-2023-74'], summary: 'Leaks Proxy-Authorization', database_specific: { severity: 'MODERATE' } }, LODASH)
  const pysec = vulnOf({ id: 'PYSEC-2023-74', aliases: ['CVE-2023-32681', 'GHSA-j8r2-6x86-q33q'], details: 'Requests leaks headers.\nMore.' }, LODASH)
  expect(mergeVulns([pysec, ghsa]).map(v => [v.id, v.severity])).toEqual([['GHSA-j8r2-6x86-q33q', 'moderate']])
  expect(pysec.summary).toBe('Requests leaks headers.')
})

test("OSV's batch is asked by each ecosystem's name and answered in order", () => {
  expect(osvName('swiftpm', 'https://github.com/vapor/vapor')).toBe('github.com/vapor/vapor')
  expect(JSON.parse(batchBody([LODASH, { name: 'requests', version: '2.25.0', ecosystem: 'pypi', isDirect: true }]))).toEqual({
    queries: [
      { package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.20' },
      { package: { name: 'requests', ecosystem: 'PyPI' }, version: '2.25.0' },
    ],
  })
  expect(batchIds(JSON.stringify({ results: [{ vulns: [{ id: 'A', modified: 'm' }] }, {}] }))).toEqual([[{ id: 'A', modified: 'm' }], []])
})

test('package-lock.json gives the whole installed tree', () => {
  const lock = JSON.stringify({
    packages: {
      '': { dependencies: { express: '^4.0.0' } },
      'node_modules/express': { version: '4.17.1' },
      'node_modules/express/node_modules/qs': { version: '6.7.0' },
      'node_modules/qs': { version: '6.11.0' },
      'node_modules/local': { link: true, version: '1.0.0' },
    },
  })
  expect(NPM.treeOf?.({ 'package-lock.json': lock })).toEqual([
    { name: 'express', version: '4.17.1' },
    { name: 'qs', version: '6.7.0' },
    { name: 'qs', version: '6.11.0' },
  ])
})

const findings: Finding[] = [
  { name: 'lodash', ecosystem: 'npm', version: '4.17.20', isDirect: true, vulns: mergeVulns([vulnOf(REDOS, LODASH), vulnOf(INJECTION, LODASH)]) },
  { name: 'qs', ecosystem: 'npm', version: '6.7.0', isDirect: false, vulns: [{ id: 'GHSA-hrpp-h998-j3pp', aliases: [], summary: 'Prototype pollution in qs', severity: 'high' }] },
]

test('each severity copies its own list, with the fix and the link', () => {
  expect(copyVulnsText(findings, 'high')).toBe(
    [
      'Vulnerabilidades de gravedad alta:',
      '- lodash 4.17.20 · GHSA-35jh-r3h4-6jhm: Command Injection in lodash. Se corrige en 4.17.21. https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm',
      '- qs 6.7.0 (indirecta) · GHSA-hrpp-h998-j3pp: Prototype pollution in qs. Sin versión que la corrija. https://osv.dev/vulnerability/GHSA-hrpp-h998-j3pp',
    ].join('\n'),
  )
  expect(fixedBy(findings[0], '4.17.21')).toBe(2)
  expect(fixedBy(findings[0], '4.17.20')).toBe(0)
  expect(auditSummary(findings, 40)).toBe('3 vulnerabilidades en 2 de 40 paquetes · 2 altas · 1 moderada')
  expect(vulnsLabel(true, { status: 'done', findings, checked: 40, at: 0 })).toBe('▾ Vulnerabilidades · 3')
  expect(vulnsColor({ status: 'done', findings, checked: 40, at: 0 })).toBe('#F0435A')
  expect(vulnsColor({ status: 'done', findings: [], checked: 40, at: 0 })).toBe('#22B573')
})

// A project with lodash (vulnerable, upgradable to its fix) and qs under
// express, OSV.dev and the npm registry standing for the engine.
function project(on: On) {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ dependencies: { lodash: '^4.17.20', express: '^4.17.1' } }),
    'package-lock.json': JSON.stringify({
      packages: {
        '': {},
        'node_modules/lodash': { version: '4.17.20' },
        'node_modules/express': { version: '4.17.1' },
        'node_modules/qs': { version: '6.7.0' },
      },
    }),
    'node_modules/lodash/package.json': JSON.stringify({ version: '4.17.20' }),
    'node_modules/express/package.json': JSON.stringify({ version: '4.17.1' }),
  }
  const store = new Map<string, unknown>()
  const keyOf = (path: string) => {
    const at = path.replace(/\\/g, '/')
    return Object.keys(files)
      .sort((a, b) => b.length - a.length)
      .find(name => at === name || at.endsWith(`/${name}`))
  }
  const advisories: Record<string, unknown> = {
    [REDOS.id]: REDOS,
    [INJECTION.id]: INJECTION,
    'GHSA-hrpp-h998-j3pp': { id: 'GHSA-hrpp-h998-j3pp', summary: 'Prototype pollution in qs', database_specific: { severity: 'HIGH' }, affected: [] },
  }
  const asked: string[] = []
  on('fs.exists', (_, e) => ({ value: keyOf(e.path) !== undefined }))
  on('fs.read', (_, e) => {
    const key = keyOf(e.path)
    if (key === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: files[key] as string }
  })
  on('http.fetch', (_, e) => {
    const ok = (text: string) => ({ value: { status: 200, ok: true, headers: {}, text } })
    if (e.url === 'https://api.osv.dev/v1/querybatch') {
      const queries = (JSON.parse(e.init?.body ?? '{}') as { queries: { package: { name: string } }[] }).queries
      asked.push(...queries.map(q => q.package.name))
      const ids: Record<string, string[]> = { lodash: [REDOS.id, INJECTION.id], qs: ['GHSA-hrpp-h998-j3pp'] }
      return ok(JSON.stringify({ results: queries.map(q => ({ vulns: (ids[q.package.name] ?? []).map(id => ({ id, modified: '1' })) })) }))
    }
    const id = /\/v1\/vulns\/(.+)$/.exec(e.url)?.[1]
    if (id) return ok(JSON.stringify(advisories[decodeURIComponent(id)]))
    const versions: Record<string, string> = { lodash: '4.17.21', express: '4.17.1' }
    const name = e.url.replace('https://registry.npmjs.org/', '').replace(/\/latest$/, '')
    return ok(JSON.stringify({ version: versions[name] ?? '0.0.0' }))
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return { asked, store }
}

async function settled($: Engine) {
  for (let i = 0; i < 150; i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const busy = await ui.find({ type: 'Text', text: /^Buscando/ })
    await ui.unmount()
    if (!busy) return
    await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  }
}

test('the vulnerabilities section lists findings by severity, copies each, and marks the upgrade that fixes them', async ($, on) => {
  const { asked } = project(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($)
  // The whole tree from the lockfile: qs too, though no manifest names it.
  expect(asked.sort()).toEqual(['express', 'lodash', 'qs'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /Vulnerabilidades/ }))?.text).toBe('▾ Vulnerabilidades · 3')
  expect((await ui.find({ type: 'Text', text: /vulnerabilidades en/ }))?.text).toBe('3 vulnerabilidades en 2 de 3 paquetes · 2 altas · 1 moderada')
  expect((await ui.find({ type: 'Text', text: /^Alta/ }))?.text).toBe('Alta (2)')
  expect((await ui.find({ type: 'Text', text: /^qs/ }))?.text).toBe('qs 6.7.0 · indirecta · GHSA-hrpp-h998-j3pp')
  // The upgrade to lodash 4.17.21 fixes both of its vulnerabilities.
  expect((await ui.find({ type: 'Text', text: /^lodash 4\.17\.20 → / }))?.text).toBe('lodash 4.17.20 → 4.17.21 · corrige 2 vulnerabilidades')

  await ui.press({ key: 'copy-vulns-moderate' })
  expect(copied).toEqual([
    'Vulnerabilidades de gravedad moderada:\n- lodash 4.17.20 · GHSA-29mw-wpgm-hmr9: Regular Expression Denial of Service (ReDoS) in lodash. Se corrige en 4.17.21. https://osv.dev/vulnerability/GHSA-29mw-wpgm-hmr9',
  ])

  await ui.press({ key: 'section-vulns' })
  expect((await ui.find({ type: 'Button', text: /Vulnerabilidades/ }))?.text).toBe('▸ Vulnerabilidades · 3')
  expect(await ui.find({ type: 'Text', text: /^qs/ })).toBeUndefined()
  await ui.unmount()
})

test('an advisory read before is not fetched again while OSV says it has not changed', async ($, on) => {
  const { store } = project(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settled($)
  expect((store.get(`osv:${REDOS.id}`) as { modified: string }).modified).toBe('1')
})

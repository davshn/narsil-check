import { expect, test } from 'claude-code/testing'

import { classify, clean, firstLine, memoryIds, shortModel } from '../hooks/map/classify'
import { SVG_LIMIT, describeMap, drawMap } from '../hooks/map/draw'
import { SETUP, STATIONS } from '../hooks/map/stations'
import { narsilFor } from '../hooks/map/narsil'
import { WORDS, mapLabel, mapTone } from '../hooks/map/words'
import { ANIMADA_PARADA_CLARO, ANIMADA_PARADA_OSCURO, ANIMADA_TRABAJANDO_CLARO, ANIMADA_TRABAJANDO_OSCURO } from '../hooks/narsil-anim'
import { PARADA_CLARO, PARADA_OSCURO, TRABAJANDO_CLARO, TRABAJANDO_OSCURO } from '../hooks/narsil-art'
import { PALETTE } from '../hooks/words'
import type { MapBoard } from '../types'

const NARSIL = { light: PARADA_CLARO, dark: PARADA_OSCURO }
const NOW = 1_000_000
const IDS = ['you', 'model', 'memory', 'files', 'shell', 'web', 'browser', 'agents', 'skills', 'hooks'] as const

/** A board at its fullest: every kept entry running, long labels, a subagent crew, a model switch. */
const fullest: MapBoard = {
  model: 'claude-opus-5-5',
  step: 12,
  context: 93,
  switchedAt: NOW - 100,
  agents: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
  faults: { shell: 3 },
  counts: { files: 12345, memory: 9 },
  pushed: 4,
  entries: Array.from({ length: 80 }, (_, i) => ({
    id: String(i),
    station: IDS[i % IDS.length] as (typeof IDS)[number],
    label: 'x'.repeat(70),
    from: 'core' as const,
    startedAt: NOW - 100 - i,
    status: 'run' as const,
  })),
}

test('the map at its fullest, with baby Narsil, stays within what Svg accepts', () => {
  const svg = drawMap(fullest, NOW, [NARSIL])
  expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
  expect(svg).toContain(PARADA_CLARO.src)
  expect(svg).toContain(PARADA_OSCURO.src)
  expect(svg).toContain('<animateMotion')
  expect(svg).toContain('opus 5.5 · 93%')
  // Labels never reach the drawing, and every number is a number.
  expect(svg).not.toContain('xxxxx')
  expect(svg).not.toContain('NaN')
  expect(svg).not.toContain('Infinity')
  expect(svg).not.toContain('=""')
  expect(/"[a-z-]+="/.test(svg)).toBe(false)
  // Narsil's colors, repainted for a light surface.
  expect(svg).toContain(`fill="${PALETTE.error.toLowerCase()}"`)
  expect(svg).toContain('@media (prefers-color-scheme: light)')
})

test('pictures too big for Svg leave the map whole, with her name at the core', () => {
  const huge = { src: `data:image/png;base64,${'A'.repeat(SVG_LIMIT)}`, width: 90, height: 150 }
  const svg = drawMap({ entries: [], counts: {} }, NOW, [{ light: huge, dark: huge }])
  expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
  expect(svg).toContain('>NARSIL</text>')
  expect(svg).not.toContain('<image')
})

test('with nothing running, baby Narsil sleeps at the core in her animated loop', () => {
  const idle: MapBoard = {
    entries: [{ id: '1', station: 'files', label: 'leer', from: 'core', startedAt: NOW - 5000, endedAt: NOW - 4000, status: 'ok' }],
    counts: {},
  }
  const svg = drawMap(idle, NOW, narsilFor(idle))
  expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
  expect(svg).toContain(ANIMADA_PARADA_CLARO.src)
  expect(svg).toContain(ANIMADA_PARADA_OSCURO.src)
  expect(svg).not.toContain(ANIMADA_TRABAJANDO_CLARO.src)
  expect(svg).not.toContain(TRABAJANDO_CLARO.src)
})

test('while work runs, baby Narsil is awake at the core in her animated loop', () => {
  const working: MapBoard = {
    entries: [{ id: '1', station: 'shell', label: 'npm test', from: 'core', startedAt: NOW - 100, status: 'run' }],
    counts: {},
  }
  const svg = drawMap(working, NOW, narsilFor(working))
  expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
  expect(svg).toContain(ANIMADA_TRABAJANDO_CLARO.src)
  expect(svg).toContain(ANIMADA_TRABAJANDO_OSCURO.src)
  expect(svg).not.toContain(ANIMADA_PARADA_CLARO.src)
  expect(svg).not.toContain(PARADA_CLARO.src)
})

test('when her loop would not fit, the core takes the next picture of her that does', () => {
  const loop = { src: `data:image/webp;base64,${'L'.repeat(SVG_LIMIT)}`, width: 90, height: 128 }
  const still = { src: 'data:image/png;base64,STILL', width: 90, height: 150 }
  const svg = drawMap({ entries: [], counts: {} }, NOW, [{ light: loop, dark: loop }, { light: still, dark: still }])
  expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
  expect(svg).not.toContain('LLLL')
  expect(svg).toContain(still.src)
  expect(svg).not.toContain('>NARSIL</text>')
})

test('awake at the map at its fullest, the drawing still stays within what Svg accepts', () => {
  const svg = drawMap(fullest, NOW, narsilFor(fullest))
  expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
  expect(svg).not.toContain(PARADA_CLARO.src)
  expect(svg).not.toContain(ANIMADA_PARADA_CLARO.src)
})

test('the section reads its state: its toggle, its color and what a reader hears', () => {
  expect(mapLabel(true)).toBe('▾ Mapa mental')
  expect(mapLabel(false)).toBe('▸ Mapa mental')
  expect(mapTone({ entries: [], counts: {} })).toBe(PALETTE.done)
  expect(mapTone({ ...fullest, faults: {} })).toBe(PALETTE.info)
  expect(mapTone(fullest)).toBe(PALETTE.error)
  expect(describeMap({ entries: [], counts: {}, context: 41.6 })).toBe('Mapa mental. No hay nada en ejecución. · contexto 42%')
  expect(describeMap({ ...fullest, entries: fullest.entries.slice(0, 2).map(e => ({ ...e, label: 'b/c.ts' })) })).toBe('Mapa mental. Modelo: b/c.ts y 1 más · contexto 93%')
})

const at = (tool: string, input: Record<string, unknown> = {}) => classify(tool, input, SETUP)

test('every kind of call lands on its station', () => {
  expect(at('Read', { file_path: '/a/b/c/content.py' })).toEqual({ station: 'files', label: 'c/content.py' })
  expect(at('Edit', { file_path: '/Users/a/.claude/projects/p/memory/n.md' }).station).toBe('memory')
  expect(at('Grep', { pattern: 'secret' })).toEqual({ station: 'files', label: 'Grep' })
  expect(at('Bash', { command: 'git push origin main' }).station).toBe('web')
  expect(at('Bash', { command: 'gh pr list' }).station).toBe('web')
  expect(at('Bash', { command: 'git status' }).station).toBe('shell')
  expect(at('Bash', { command: 'D=/tmp; cat $D/a | grep x; echo done' }).station).toBe('files')
  expect(at('WebFetch', { url: 'https://a.b/c?q=1' })).toEqual({ station: 'web', label: 'a.b' })
  expect(at('WebSearch', { query: 'private' })).toEqual({ station: 'web', label: 'búsqueda web' })
  expect(at('mcp__Claude_Browser__navigate', { url: 'https://a.b/c' })).toEqual({ station: 'browser', label: 'a.b' })
  expect(at('Agent', { description: 'map the flow' })).toEqual({ station: 'agents', label: 'map the flow' })
  expect(at('Skill', { skill: 'pdf' })).toEqual({ station: 'skills', label: 'pdf' })
  expect(at('ToolSearch', { query: 'x' })).toEqual({ station: 'skills', label: 'cargando herramientas' })
  expect(at('AskUserQuestion')).toEqual({ station: 'you', label: 'pregunta para ti' })
  expect(at('mcp__engram__mem_save', { content: 'private' })).toEqual({ station: 'web', label: 'engram: mem save' })
  expect(at('mcp__ccd_turn__update_plan')).toEqual({ station: 'you', label: 'update plan' })
})

test('a command behind a wrapper or inside another is the command it runs', () => {
  expect(at('Bash', { command: 'sudo -u deploy curl https://x.y' }).station).toBe('web')
  expect(at('Bash', { command: 'timeout 5 wget x' }).station).toBe('web')
  expect(at('Bash', { command: 'bash -c "curl https://x.y"' }).station).toBe('web')
  expect(at('Bash', { command: 'echo $(curl -s https://x.y)' }).station).toBe('web')
  expect(at('Bash', { command: 'grep -E "curl|wget" notes.txt' }).station).toBe('files')
  expect(at('Bash', { command: 'cat > a.sh <<EOF\ncurl https://x.y\nEOF' }).station).toBe('files')
})

test('the PowerShell tool is read like the shell, by its own command names', () => {
  expect(at('PowerShell', { command: 'Get-Content notes.txt', description: 'Read notes' })).toEqual({ station: 'files', label: 'Read notes' })
  expect(at('PowerShell', { command: 'Invoke-WebRequest https://x.y' }).station).toBe('web')
  expect(at('PowerShell', { command: 'git status' }).station).toBe('shell')
})

test('labels never carry what was written, searched or a password', () => {
  expect(at('Write', { file_path: 'C:\\Users\\a\\p\\secret.txt', content: 'hunter2' }).label).toBe('p/secret.txt')
  expect(at('WebFetch', { url: 'https://user:pa/ss@host.example/x' }).label).toBe('host.example')
  expect(at('Bash', { command: 'echo hunter2 > key', description: '' }).label).toBe('echo')
  expect(clean('a\u001b[31mb\u202ec')).toBe('a [31mb c')
  expect(clean('x'.repeat(200)).length).toBe(120)
})

test('helpers read names and numbers only', () => {
  expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
  expect(shortModel('gpt')).toBe('gpt')
  expect(firstLine('\nBlocked: no\nrest')).toBe('Blocked: no')
  expect(memoryIds('[#12 x] [now #7] [#12]')).toEqual(['12', '7'])
})

test('every station has its Spanish name and an icon', () => {
  expect(STATIONS.map(s => WORDS.stations[s.id])).toEqual(['Tú', 'Modelo', 'Memoria', 'Archivos', 'Terminal', 'Red', 'Navegador', 'Agentes', 'Skills', 'Hooks'])
  expect(STATIONS.every(s => s.icon.startsWith('M'))).toBe(true)
})

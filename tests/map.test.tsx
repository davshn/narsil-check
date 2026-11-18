import { expect, test } from 'claude-code/testing'

import { classify, clean, firstLine, memoryIds, shortModel } from '../hooks/map/classify'
import { SETUP, STATIONS } from '../hooks/map/stations'
import { WORDS } from '../hooks/map/words'

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

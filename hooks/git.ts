// Turning upgraded dependencies into a pull request: what changed, read from
// git itself, and the branch, commit and PR texts. Pure functions over plain
// values: the hooks module runs git and gh.

export type Change = { name: string; from: string; to: string }

// The dependencies whose range changed, from `git diff -U0 -- package.json`.
// A line removed and a line added for the same name is one change; only
// `names`, the dependencies package.json declares, count, so the project's
// own "version" or a script is never taken for one.
export function changesOf(diff: string, names: string[]): Change[] {
  const line = /^([+-])\s*"([^"]+)":\s*"([^"]*)",?\s*$/
  const removed = new Map<string, string>()
  const added = new Map<string, string>()
  for (const text of diff.split(/\r?\n/)) {
    if (text.startsWith('+++') || text.startsWith('---')) continue
    const m = line.exec(text)
    if (!m) continue
    const [, sign, name, spec] = m as unknown as [string, string, string, string]
    ;(sign === '-' ? removed : added).set(name, spec)
  }
  const changes: Change[] = []
  for (const [name, to] of added) {
    const from = removed.get(name)
    if (from !== undefined && from !== to && names.includes(name)) changes.push({ name, from, to })
  }
  return changes.sort((a, b) => a.name.localeCompare(b.name))
}

// Whether `branch` is the repository's default: the one origin's HEAD names
// (`git symbolic-ref --short refs/remotes/origin/HEAD` prints "origin/main"),
// else main or master when origin names none.
export function isMainBranch(branch: string, originHead: string): boolean {
  const named = originHead.trim().replace(/^origin\//, '')
  return named ? branch === named : branch === 'main' || branch === 'master'
}

export function day(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The branch the PR comes from; `taken` adds the time when the day's name is used.
export function branchName(ms: number, taken: boolean): string {
  const d = new Date(ms)
  const time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  return `chore/upgrade-deps-${day(ms)}${taken ? `-${time}` : ''}`
}

export function commitTitle(changes: Change[]): string {
  return `chore(deps): upgrade ${changes.length} ${changes.length === 1 ? 'dependency' : 'dependencies'}`
}

export function commitBody(changes: Change[]): string {
  return changes.map(c => `- ${c.name}: ${c.from} -> ${c.to}`).join('\n')
}

export function prBody(changes: Change[], manager: string): string {
  return [
    '## Summary',
    '',
    `Upgrades ${changes.length} ${changes.length === 1 ? 'dependency' : 'dependencies'} to newer patch or minor releases, installed with \`${manager}\`.`,
    '',
    '| Package | From | To |',
    '| --- | --- | --- |',
    ...changes.map(c => `| \`${c.name}\` | \`${c.from}\` | \`${c.to}\` |`),
    '',
    '## Test plan',
    '',
    '- [ ] Run the test suite',
    '- [ ] Build the project',
  ].join('\n')
}

// The PR's address: the last line gh prints that is one.
export function prUrlOf(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^https:\/\/\S+\/pull\/\d+$/.test(l))
    .pop()
}

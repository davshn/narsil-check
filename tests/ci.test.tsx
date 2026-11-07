import { expect, test } from 'claude-code/testing'

import { ciLabel, ciMark, jobsOf, latestRuns, markOf, runListArgv, runViewArgv } from '../hooks/ci'
import type { CiView } from '../types'

const step = (name: string, status: string, conclusion = '') => ({ name, status, conclusion, number: 1 })

test("the newest commit's runs, one per workflow, newest first", () => {
  const list = JSON.stringify([
    { databaseId: 12, headSha: 'abc', workflowName: 'CI', status: 'in_progress', conclusion: '' },
    { databaseId: 11, headSha: 'abc', workflowName: 'CI', status: 'completed', conclusion: 'cancelled' },
    { databaseId: 10, headSha: 'abc', workflowName: 'CodeQL', status: 'queued', conclusion: '' },
    { databaseId: 9, headSha: 'old', workflowName: 'CI', status: 'completed', conclusion: 'failure' },
  ])
  expect(latestRuns(list)).toEqual({
    sha: 'abc',
    runs: [
      { id: 12, name: 'CI', status: 'in_progress', conclusion: '' },
      { id: 10, name: 'CodeQL', status: 'queued', conclusion: '' },
    ],
  })
  expect(latestRuns('[]')).toEqual({ sha: '', runs: [] })
  expect(runListArgv('o/r', 'feat/x')).toEqual(['gh', 'run', 'list', '--repo', 'o/r', '--branch', 'feat/x', '--json', 'databaseId,headSha,workflowName,status,conclusion', '--limit', '20'])
  expect(runViewArgv('o/r', 12)).toEqual(['gh', 'run', 'view', '12', '--repo', 'o/r', '--json', 'jobs'])
})

test("a run's steps leave out GitHub's own bookkeeping", () => {
  const view = JSON.stringify({
    jobs: [
      {
        name: 'quality',
        status: 'in_progress',
        conclusion: '',
        steps: [step('Set up job', 'completed', 'success'), step('Lint', 'completed', 'success'), step('Build', 'in_progress'), step('Post Checkout', 'pending'), step('Complete job', 'pending')],
      },
    ],
  })
  expect(jobsOf(view)).toEqual([
    {
      name: 'quality',
      status: 'in_progress',
      conclusion: '',
      steps: [
        { name: 'Lint', status: 'completed', conclusion: 'success' },
        { name: 'Build', status: 'in_progress', conclusion: '' },
      ],
    },
  ])
  expect(jobsOf('{}')).toEqual([])
})

test('each step shows as done, failed, going, waiting or skipped', () => {
  expect(markOf('completed', 'success')).toEqual({ mark: '✓', color: '#22B573' })
  expect(markOf('completed', 'failure').mark).toBe('✗')
  expect(markOf('completed', 'cancelled').mark).toBe('✗')
  expect(markOf('completed', 'skipped').mark).toBe('–')
  expect(markOf('in_progress', '')).toEqual({ mark: '◐', color: '#F5B400' })
  expect(markOf('queued', '').mark).toBe('○')
})

test("the fold's line says how far the CI is", () => {
  const run = (status: string, conclusion: string, steps: { name: string; status: string; conclusion: string }[]) => ({
    id: 1,
    name: 'CI',
    status,
    conclusion,
    jobs: [{ name: 'quality', status, conclusion, steps }],
  })
  const ready = (runs: CiView['runs'], extra: Partial<CiView> = {}): CiView => ({ status: 'ready', runs, ...extra })
  const going = run('in_progress', '', [
    { name: 'Lint', status: 'completed', conclusion: 'success' },
    { name: 'Typecheck', status: 'in_progress', conclusion: '' },
    { name: 'Build', status: 'queued', conclusion: '' },
  ])
  expect(ciLabel(true, ready([going]))).toBe('▾ CI · 1/3 · Typecheck')
  expect(ciMark(ready([going])).mark).toBe('◐')
  expect(ciLabel(false, ready([run('completed', 'success', [])]))).toBe('▸ CI · pasó')
  expect(ciMark(ready([run('completed', 'success', [])])).mark).toBe('✓')
  expect(ciLabel(true, ready([run('completed', 'failure', [])]))).toBe('▾ CI · falló')
  expect(ciMark(ready([run('completed', 'failure', [])])).mark).toBe('✗')
  expect(ciLabel(true, ready([]))).toBe('▾ CI · sin ejecuciones')
  expect(ciLabel(true, ready([], { isWaiting: true }))).toBe('▾ CI · esperando el CI del último push')
  expect(ciLabel(true, ready([], { error: 'gh: not logged in' }))).toBe('▾ CI · sin leer')
  expect(ciLabel(true, { status: 'loading', runs: [] })).toBe('▾ CI')
})

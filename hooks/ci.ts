// The CI of the session's pull request, step by step: GitHub Actions' runs on
// its head branch, each job and its steps, as gh answers them. Pure: the
// hooks module runs gh and draws it.

import type { CiJob, CiRun, CiView } from '../types'
import { PALETTE } from './words'

// How often the fold asks gh again while a run is going.
export const CI_POLL_MS = 10_000
// How many times it waits for a run to show up for a commit just pushed.
export const CI_WAIT_POLLS = 12

const RUN_FIELDS = 'databaseId,headSha,workflowName,status,conclusion'

export function runListArgv(repo: string, branch: string): string[] {
  return ['gh', 'run', 'list', '--repo', repo, '--branch', branch, '--json', RUN_FIELDS, '--limit', '20']
}

export function runViewArgv(repo: string, id: number): string[] {
  return ['gh', 'run', 'view', String(id), '--repo', repo, '--json', 'jobs']
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

// The runs of the newest commit on the branch, one per workflow: gh lists
// the newest first, so the first one names the commit.
export function latestRuns(text: string): { sha: string; runs: { id: number; name: string; status: string; conclusion: string }[] } {
  const list = JSON.parse(text) as unknown
  if (!Array.isArray(list) || list.length === 0) return { sha: '', runs: [] }
  const sha = str((list[0] as { headSha?: unknown }).headSha)
  const seen = new Set<string>()
  const runs: { id: number; name: string; status: string; conclusion: string }[] = []
  for (const item of list as Record<string, unknown>[]) {
    if (str(item.headSha) !== sha || typeof item.databaseId !== 'number') continue
    const name = str(item.workflowName)
    if (seen.has(name)) continue
    seen.add(name)
    runs.push({ id: item.databaseId, name, status: str(item.status), conclusion: str(item.conclusion) })
  }
  return { sha, runs }
}

// GitHub's own bookkeeping steps, which say nothing about the project.
const NOISE = /^(Set up job|Complete job|Post .+)$/

// A run's jobs and their steps, without the bookkeeping ones.
export function jobsOf(text: string): CiJob[] {
  const jobs = (JSON.parse(text) as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) return []
  return (jobs as Record<string, unknown>[]).map(job => ({
    name: str(job.name),
    status: str(job.status),
    conclusion: str(job.conclusion),
    steps: (Array.isArray(job.steps) ? (job.steps as Record<string, unknown>[]) : [])
      .map(step => ({ name: str(step.name), status: str(step.status), conclusion: str(step.conclusion) }))
      .filter(step => !NOISE.test(step.name)),
  }))
}

const FAILED = ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']

// A step, a job or a run, as a mark and its color: done, failed, going,
// waiting or skipped.
export function markOf(status: string, conclusion: string): { mark: string; color: string } {
  if (status === 'completed') {
    if (FAILED.includes(conclusion)) return { mark: '✗', color: PALETTE.error }
    if (conclusion === 'skipped' || conclusion === 'neutral') return { mark: '–', color: PALETTE.muted }
    return { mark: '✓', color: PALETTE.done }
  }
  if (status === 'in_progress') return { mark: '◐', color: PALETTE.waiting }
  return { mark: '○', color: PALETTE.muted }
}

export function isGoing(runs: readonly CiRun[]): boolean {
  return runs.some(run => run.status !== 'completed')
}

// The fold's line: how far the CI is, at a glance.
export function ciLabel(isOpen: boolean, ci: CiView): string {
  const head = `${isOpen ? '▾' : '▸'} CI`
  if (ci.error) return `${head} · sin leer`
  if (ci.isWaiting) return `${head} · esperando el CI del último push`
  if (ci.status !== 'ready') return head
  if (ci.runs.length === 0) return `${head} · sin ejecuciones`
  const steps = ci.runs.flatMap(run => run.jobs.flatMap(job => job.steps))
  if (isGoing(ci.runs)) {
    const done = steps.filter(step => step.status === 'completed').length
    const now = steps.find(step => step.status === 'in_progress')
    return `${head} · ${done}/${steps.length}${now ? ` · ${now.name}` : ''}`
  }
  return ci.runs.some(run => FAILED.includes(run.conclusion)) ? `${head} · falló` : `${head} · pasó`
}

// The fold's mark: the whole CI as one run.
export function ciMark(ci: CiView): { mark: string; color: string } {
  if (ci.error || ci.status !== 'ready' || ci.runs.length === 0) return { mark: '○', color: PALETTE.muted }
  if (ci.isWaiting || isGoing(ci.runs)) return { mark: '◐', color: PALETTE.waiting }
  return ci.runs.some(run => FAILED.includes(run.conclusion)) ? markOf('completed', 'failure') : markOf('completed', 'success')
}

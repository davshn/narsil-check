// The board: what the work map shows, kept in the session's state, and the few ways it is
// written. Ported from lot-map's hooks/board.ts and hooks/feed.ts (https://github.com/alexeyw/lot-map,
// MIT, Copyright (c) 2026 Aleksei Volodin), without its context-cost sums. Every write goes through
// `quietly`, so that nothing that goes wrong here reaches the tool, the turn or the conversation.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { MapBoard as Board, MapEntry as Entry, MapStatus as Status, StationId } from '../../types'
import { clean } from './classify'

const KEEP = 80
const CREW = 12

// Change the tag when a field of MapEntry or MapBoard changes: it declines what an earlier version stored.
const board = atom({ plugin: 'narsil-check', key: 'board' } as const, { entries: [], counts: {} } as Board, { shape: 'board-1' })

/** The board as it stands. Every read and write of the board is made in this file. */
export function readBoard($: EngineInterface): Promise<Board> {
  return read($, board)
}

/** The board changed by `by`. Not quiet: the caller says what a failure may reach. */
export function change($: EngineInterface, by: (b: Board) => Board): Promise<unknown> {
  return update($, board, by)
}

export const newId = (now: number): string => `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Whatever goes wrong on the map must never reach the tool, the turn or the conversation. */
export async function quietly<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

export type Start = {
  station: StationId
  label: string
  from?: Entry['from']
  status?: Status
  agentId?: string
  mark?: Entry['mark']
  /** Adds nothing to the station's count: a second view of something already counted. */
  uncounted?: boolean
  startedAt?: number
  endedAt?: number
  patch?: Partial<Pick<Board, 'model' | 'step' | 'switchedAt'>>
}

/** The newest entries, and beside them every background task still going, however long ago it started. */
export const kept = (entries: Entry[]): Entry[] => {
  const from = entries.length - KEEP
  return from <= 0 ? entries : entries.filter((e, i) => i >= from || (e.status === 'run' && e.task !== undefined))
}

const isFault = (status: Status): boolean => status === 'err' || status === 'block'

const oneMore = (faults: Board['faults'], station: StationId): Board['faults'] => ({ ...faults, [station]: (faults?.[station] ?? 0) + 1 })

export async function begin($: EngineInterface, start: Start): Promise<string | undefined> {
  return quietly(async () => {
    const now = await $.clock.now()
    const entry: Entry = {
      id: newId(now),
      station: start.station,
      label: clean(start.label),
      from: start.from ?? 'core',
      startedAt: start.startedAt ?? now,
      status: start.status ?? 'run',
      ...(start.status !== undefined ? { endedAt: start.endedAt ?? now } : {}),
      ...(start.agentId !== undefined ? { agentId: start.agentId } : {}),
      ...(start.mark !== undefined ? { mark: start.mark } : {}),
    }
    await update($, board, b => ({
      ...b,
      ...start.patch,
      entries: kept([...b.entries, entry]),
      counts: start.uncounted ? b.counts : { ...b.counts, [entry.station]: (b.counts[entry.station] ?? 0) + 1 },
      // What a hook brought to memory unasked is counted apart from what was asked for.
      ...(entry.station === 'memory' && entry.from === 'inbound' && !start.uncounted ? { pushed: (b.pushed ?? 0) + 1 } : {}),
      // An interrupted turn lands on the person's own station and is no fault of anything.
      ...(isFault(entry.status) && entry.station !== 'you' ? { faults: oneMore(b.faults, entry.station) } : {}),
      ...(entry.agentId !== undefined && !(b.agents ?? []).includes(entry.agentId)
        ? { agents: [...(b.agents ?? []), entry.agentId].slice(-CREW) }
        : {}),
    }))
    return entry.id
  })
}

export async function finish($: EngineInterface, id: string | undefined, status: Status, patch?: Pick<Board, 'context'>): Promise<void> {
  if (id === undefined) return
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.id === id && e.status === 'run')
      return {
        ...b,
        ...patch,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now } : e)),
        ...(open !== undefined && isFault(status) ? { faults: oneMore(b.faults, open.station) } : {}),
      }
    })
  })
}

/** The call started work that goes on after it answered: its entry stays open under the task's id. */
export async function background($: EngineInterface, id: string | undefined, task: string): Promise<void> {
  if (id === undefined) return
  await quietly(() => update($, board, b => ({ ...b, entries: b.entries.map(e => (e.id === id && e.status === 'run' ? { ...e, task } : e)) })))
}

/** A background task ended: its entry closes, as a fault when the task failed. */
export async function settle($: EngineInterface, task: string, status: Status): Promise<void> {
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.task === task && e.status === 'run')
      if (open === undefined) return b
      return {
        ...b,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now } : e)),
        ...(isFault(status) ? { faults: oneMore(b.faults, open.station) } : {}),
      }
    })
  })
}

/** How full the context window is, as the status line has it; costs nothing. */
export async function contextOf($: EngineInterface): Promise<Pick<Board, 'context'>> {
  const context = await quietly(async () => (await $.session.usage()).context)
  return typeof context?.percent === 'number' ? { context: context.percent } : {}
}

/**
 * The id of the background task a tool's answer started, if it started one: a shell command sent to the
 * background, a subagent or workflow launched to run on, a monitor.
 */
export function taskOf(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const r = result as Record<string, unknown>
  const id = (v: unknown): string | undefined => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : undefined)
  if (r.status === 'async_launched' || r.status === 'remote_launched') return id(r.agentId) ?? id(r.taskId)
  return id(r.backgroundTaskId) ?? (typeof r.timeoutMs === 'number' ? id(r.taskId) : undefined)
}

/**
 * A background task's notification, read for the task's id and how it ended and for nothing else:
 * its summary and output never reach the map. No status: the task spoke and goes on (a monitor's event).
 */
export function taskNotice(text: string): { id: string; status?: Status } | undefined {
  if (!text.trimStart().startsWith('<task-notification>')) return undefined
  const id = /<task-id>([\w-]{1,64})<\/task-id>/.exec(text)?.[1]
  if (id === undefined) return undefined
  const word = /<status>(\w+)<\/status>/.exec(text)?.[1]
  if (word === undefined) return { id }
  return { id, status: word === 'failed' ? 'err' : 'ok' }
}

/** Keeps the newest `max` keys of a set or a map, which hand their keys back in the order they were added. */
export function keepNewest(kept: { readonly size: number; keys(): IterableIterator<string>; delete(key: string): boolean }, max: number): void {
  for (const key of kept.keys()) {
    if (kept.size <= max) break
    kept.delete(key)
  }
}

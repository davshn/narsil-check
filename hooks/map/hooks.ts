// The events the work map listens to, and what each puts on the board. Ported from lot-map's
// hooks/register.ts (https://github.com/alexeyw/lot-map, MIT, Copyright (c) 2026 Aleksei Volodin)
// without its pane, command, options and context-cost sums. Every hook passes its event on
// unchanged: the map never alters an input, a result, the context or a permission decision.
import type { EngineInterface, Hook, On } from 'claude-code'

import type { MapEntry as Entry } from '../../types'
import { background, begin, change, contextOf, expired, finish, keepNewest, kept, newId, quietly, settle, taskNotice, taskOf } from './board'
import { classify, clean, shortModel } from './classify'
import { SETUP } from './stations'
import { WORDS as t } from './words'

/** How many refusals are remembered until their calls come by: a call that never comes would stay for the whole session. */
const REFUSALS_KEPT = 64

/** What a settings hook added to the context: shown as the hook acting, never as its text. */
async function noteContext($: EngineInterface, context: readonly string[] | undefined, when: string): Promise<void> {
  if ((context ?? []).join('\n').trim() === '') return
  await begin($, { station: 'hooks', label: t.addedContext(when), status: 'ok' })
}

// Calls a settings hook refused, so that the tool's own entry reads as blocked and not as an error.
// Loses nothing across a reload that matters: a reload never lands in the middle of a call.
const refused = new Set<string>()
// The model the main loop last ran on in this session: a change shows as a moment on the map.
let lastModel: string | undefined

// The three events the rest of Narsil Check listens to as well. A module registers an event once
// without a matcher, so register.tsx calls these from its own hooks, each in place of `next(e)`.

type TurnStartArgs = Parameters<Hook<'turn.start'>>
export async function mapTurnStart($: EngineInterface, e: TurnStartArgs[1], next: TurnStartArgs[2]): Promise<Awaited<ReturnType<Hook<'turn.start'>>>> {
  const notice = e.agentId === undefined ? taskNotice(e.text) : undefined
  if (notice !== undefined) {
    // A background task reporting back is no message of the person's.
    if (notice.status !== undefined) await settle($, notice.id, notice.status)
  } else if (e.agentId === undefined && e.text !== '') {
    // A new message clears what went wrong on the way to the last answer.
    await quietly(() => change($, b => (b.faults === undefined ? b : { ...b, faults: {} })))
    await begin($, { station: 'you', label: t.newMessage, from: 'inbound', status: 'ok' })
  }
  return next(e)
}

type TurnCompleteArgs = Parameters<Hook<'turn.complete'>>
export async function mapTurnComplete($: EngineInterface, e: TurnCompleteArgs[1], next: TurnCompleteArgs[2]): Promise<Awaited<ReturnType<Hook<'turn.complete'>>>> {
  if (e.agentId !== undefined) {
    // A subagent's loop is over: it leaves the agents station, and a call of its that never reported back is settled.
    const agentId = e.agentId
    await quietly(async () => {
      const now = await $.clock.now()
      await change($, b => ({
        ...b,
        agents: (b.agents ?? []).filter(id => id !== agentId),
        entries: b.entries.map(x => (x.status === 'run' && (x.agentId === agentId || x.task === agentId) ? { ...x, status: 'ok' as const, endedAt: now } : x)),
      }))
    })
  } else {
    await begin($, {
      station: 'you',
      label: e.isAborted ? t.turnAborted : t.answerReady,
      status: e.isAborted ? 'err' : 'ok',
      ...(e.isAborted ? {} : { mark: 'done' as const }),
    })
    // An interrupted call never reports back; left alone its entry would pulse for the rest of the session.
    // Nor does a background task whose notification never came: it is closed once it is an hour old.
    await quietly(async () => {
      const now = await $.clock.now()
      await change($, b => ({
        ...b,
        entries: expired(b.entries, now).map(x => (x.status === 'run' && x.from === 'core' && x.task === undefined ? { ...x, status: 'ok' as const, endedAt: now } : x)),
      }))
    })
  }
  return next(e)
}

type ToolCallArgs = Parameters<Hook<'tool.call'>>
export async function mapToolCall($: EngineInterface, e: ToolCallArgs[1], next: ToolCallArgs[2]): Promise<Awaited<ReturnType<Hook<'tool.call'>>>> {
  // The tool never waits on the map: the entry is written beside the call, and closed once both are done.
  const started = quietly(async () => {
    const seen = classify(e.tool, e as unknown as Record<string, unknown>, SETUP)
    return begin($, { ...seen, ...(e.agentId === undefined ? { from: 'core' as const } : { from: 'agents' as const, agentId: e.agentId }) })
  })
  const close = (how: (id: string | undefined) => Promise<void>): void => {
    void started.then(how).catch(() => undefined)
  }
  try {
    const ran = await next(e)
    const wasRefused = ran.deny !== undefined || (e.tool_use_id !== undefined && refused.delete(e.tool_use_id))
    const task = wasRefused || ran.isError === true ? undefined : taskOf(ran.result)
    if (task !== undefined) close(id => background($, id, task))
    else close(id => finish($, id, wasRefused ? 'block' : ran.isError === true ? 'err' : 'ok'))
    return ran
  } catch (failure) {
    close(id => finish($, id, 'err'))
    throw failure
  }
}

/** A new session starts with nothing remembered from the last one in this process. */
export function resetMap(): void {
  refused.clear()
  lastModel = undefined
}

/** The events only the map listens to. */
export function registerMap(on: On): void {
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    if (isMain && lastModel !== e.model) {
      const before = lastModel
      lastModel = e.model
      if (before !== undefined) {
        const now = await quietly(() => $.clock.now())
        await begin($, {
          station: 'model',
          label: `${shortModel(before)} → ${shortModel(e.model)}`,
          status: 'ok',
          mark: 'switch',
          uncounted: true,
          ...(now !== undefined ? { patch: { switchedAt: now } } : {}),
        })
      }
    }
    const id = await begin($, {
      station: 'model',
      label: `${shortModel(e.model)} · ${t.step(e.index + 1)}${isMain ? '' : ` · ${t.subagent}`}`,
      from: isMain ? 'core' : 'agents',
      ...(isMain ? { patch: { model: e.model, step: e.index + 1 } } : { agentId: e.agentId }),
    })
    try {
      return yield* next(e)
    } finally {
      await finish($, id, 'ok', isMain ? await contextOf($) : undefined)
    }
  })

  on('classic.PreToolUse', async ($, e, next) => {
    // The decision never waits on the map: the times are read beside it, and the entry written after.
    const started = quietly(() => $.clock.now())
    const decided = await next(e)
    // Kept now, before the tool's own hook looks for it.
    if (decided.deny !== undefined && e.tool_use_id !== undefined) {
      refused.add(e.tool_use_id)
      keepNewest(refused, REFUSALS_KEPT)
    }
    const ended = quietly(() => $.clock.now())
    void Promise.all([started, ended])
      .then(async ([from, to]) => {
        const startedAt = from ?? 0
        const endedAt = to ?? startedAt
        if (decided.deny !== undefined) {
          // The refusal's words stay back: they may repeat the whole command.
          await begin($, { station: 'hooks', label: t.stopped(e.tool), status: 'block', startedAt })
        } else if (decided.ask !== undefined) {
          await begin($, { station: 'hooks', label: t.askedPermission(e.tool), status: 'ok', startedAt, endedAt })
        } else if (endedAt - startedAt >= 400) {
          // A check that took a moment is worth seeing; the instant ones are not.
          await begin($, { station: 'hooks', label: t.checkBefore(e.tool), status: 'ok', startedAt, endedAt })
        }
      })
      .catch(() => undefined)
    return decided
  })

  // A notification delivered into a running turn starts no turn of its own; this is where it is seen.
  on('prompt.submit', async ($, e, next) => {
    await quietly(async () => {
      if (e.origin?.kind !== 'task-notification') return
      const notice = taskNotice(e.text)
      if (notice?.status !== undefined) await settle($, notice.id, notice.status)
    })
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    await noteContext($, result.additionalContext, t.toMessage)
    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await noteContext($, result.additionalContext, t.atStart)
    return result
  })

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    // A skill the model called is already on the map as its tool call; this one catches a typed slash command.
    await quietly(async () => {
      const now = await $.clock.now()
      await change($, b => {
        const label = clean(e.skill)
        if (b.entries.some(x => x.station === 'skills' && x.status === 'run' && x.label === label)) return b
        const entry: Entry = { id: newId(now), station: 'skills', label, from: 'core', startedAt: now, endedAt: now, status: 'ok' }
        return { ...b, entries: kept([...b.entries, entry]), counts: { ...b.counts, skills: (b.counts.skills ?? 0) + 1 } }
      })
    })
    return result
  })

  on('session.compact', async ($, e, next) => {
    const id = await begin($, { station: 'model', label: t.compacting })
    try {
      return await next(e)
    } finally {
      await finish($, id, 'ok', await contextOf($))
    }
  })
}

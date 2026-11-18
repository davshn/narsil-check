// How the board is drawn: one SVG, baby Narsil in the centre and a station for each kind of work.
// Ported from lot-map's hooks/draw.ts and hooks/palette.ts (https://github.com/alexeyw/lot-map,
// MIT, Copyright (c) 2026 Aleksei Volodin): the same animation, in Narsil's colors, with Narsil
// at the core where lot-map writes its name. Nothing here touches the engine.
import type { MapBoard as Board, MapEntry as Entry, StationId } from '../../types'
import type { Art } from '../narsil-art'
import { shortModel } from './classify'
import { STATIONS } from './stations'
import { WORDS } from './words'

/** The most the Svg element takes, in characters. */
export const SVG_LIMIT = 131072

type Palette = {
  ground: string
  raised: string
  line: string
  spoke: string
  bone: string
  ash: string
  dim: string
  accent: string
  hot: string
  red: string
  mem: string
  memHot: string
  /** The route between stations. */
  trail: string
}

// Narsil's palette (words.ts PALETTE): blue for work, green for memory, red for what went wrong.
// The ground is the pane's own, so the rim around the words blends in; the map paints no ground of its own.
export const DARK: Palette = {
  ground: '#262624',
  raised: '#1d1f26',
  line: '#3a3f4b',
  spoke: '#2c303a',
  bone: '#ebe6dc',
  ash: '#b4b9c8',
  dim: '#9aa0b0',
  accent: '#3b8bff',
  hot: '#8cb9ff',
  red: '#f0435a',
  mem: '#22b573',
  memHot: '#7fddb0',
  // One step away from `bone`, so that the light rules can give the route a color of its own.
  trail: '#ebe6dd',
}

export const LIGHT: Palette = {
  ground: '#faf9f5',
  raised: '#ffffff',
  line: '#cfd3dc',
  spoke: '#e3e6ec',
  bone: '#1f2228',
  ash: '#3f444e',
  dim: '#5b6170',
  accent: '#2f6fd6',
  hot: '#1d4fa3',
  red: '#d12f45',
  mem: '#178a57',
  memHot: '#0f6b43',
  trail: '#9c978b',
}

/**
 * The drawing is made in the dark palette, and these rules repaint it where the surface around it is light.
 * Every color on the map is one of the palette's, written as a plain attribute, so a rule per color reaches all of it.
 */
const lightRules = (): string =>
  `<style>@media (prefers-color-scheme: light){${(Object.keys(DARK) as (keyof Palette)[])
    .map(k => `[fill="${DARK[k]}"]{fill:${LIGHT[k]}}[stroke="${DARK[k]}"]{stroke:${LIGHT[k]}}`)
    .join('')}}</style>`

/** Baby Narsil in both themes: what stands at the core. */
export type Narsil = { light: Art; dark: Art }


const W = 460
const H = 476
/** Height over width of the drawing, for a surface that sizes it itself. */
export const MAP_ASPECT = H / W
const CX = 230
const CY = 232
const RX = 176
const RY = 164
const NODE = 28
const CORE = 54
/** Where spokes and pulses meet the core: outside the context ring. */
const HUB = CORE + 8

const FONT = 'font-family="SF Mono, ui-monospace, Menlo, monospace"'

// How long each moment of the map lasts, in milliseconds.
export const PULSE_MS = 800
const RIPPLE_MS = 450
export const GLOW_MS = 3200
export const ALARM_MS = 6000
export const SWITCH_MS = 8000
export const DONE_MS = 1100
const TRAIL_STOPS = 7
/** A leg of the route stays for a while after it was drawn, then fades: the route shows where the work is going, and the spokes keep where it went. */
export const TRAIL_HOLD_MS = 40_000
export const TRAIL_FADE_MS = 20_000

type Point = { x: number; y: number }

/** The angle of place `i` on the ring, the person at the top. */
const turn = (i: number): number => (i * 2 * Math.PI) / STATIONS.length
const at = (a: number, f = 1): Point => ({ x: CX + RX * f * Math.sin(a), y: CY - RY * f * Math.cos(a) })
const place = (i: number): Point => at(turn(i))
const indexOf = (id: StationId): number => STATIONS.findIndex(s => s.id === id)

const n1 = (v: number): string => (Math.round(v * 10) / 10).toString()
/** A moment on the drawing's own clock, which starts at zero each time it is drawn; a past moment is negative. */
const clock = (ms: number): string => `${(ms / 1000).toFixed(3)}s`

/** Where a straight line from `from` to `to` meets the circle of radius `r` around `from`. */
function edge(from: Point, to: Point, r: number): Point {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: from.x + ((to.x - from.x) * r) / d, y: from.y + ((to.y - from.y) * r) / d }
}

/** The same line moved sideways, so that several pulses on one spoke fly side by side. */
function aside(a: Point, b: Point, off: number): [Point, Point] {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const dx = (-(b.y - a.y) * off) / d
  const dy = ((b.x - a.x) * off) / d
  return [{ x: a.x + dx, y: a.y + dy }, { x: b.x + dx, y: b.y + dy }]
}

/** A pulse with a short tail behind it. A hollow one is a signal nobody asked for. */
function pulse(a: Point, b: Point, color: string, age: number, radius: number, isHollow = false): string {
  // A negative begin carries on where the last drawing left off, so a redraw never restarts a flight.
  const path = `M${n1(a.x)} ${n1(a.y)}L${n1(b.x)} ${n1(b.y)}`
  let out = ''
  for (let k = isHollow ? 0 : 2; k >= 0; k--) {
    const timing = `begin="${clock(k * 45 - age)}" dur="${clock(PULSE_MS)}" fill="freeze"`
    const peak = n1(1 - 0.36 * k)
    const paint = isHollow ? `fill="none" stroke="${color}" stroke-width="1.4"` : `fill="${color}"`
    out +=
      `<circle r="${n1(radius * (1 - 0.27 * k))}" ${paint} opacity="0">` +
      `<animateMotion path="${path}" ${timing}/>` +
      `<animate attributeName="opacity" values="${peak};${peak};0" keyTimes="0;.82;1" ${timing}/>` +
      `</circle>`
  }
  return out
}

/** A ring that spreads from where a pulse lands, at the moment it lands. */
function ripple(p: Point, r: number, color: string, age: number): string {
  const timing = `begin="${clock(PULSE_MS - age)}" dur="${clock(RIPPLE_MS)}" fill="freeze"`
  return (
    `<circle cx="${n1(p.x)}" cy="${n1(p.y)}" r="${r}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0">` +
    `<animate attributeName="r" values="${r};${r + 11}" ${timing}/>` +
    `<animate attributeName="opacity" values=".7;0" ${timing}/></circle>`
  )
}

function beam(a: Point, b: Point, color: string, age: number, isDashed: boolean): string {
  return (
    `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke="${color}" stroke-width="1.4"${isDashed ? ' stroke-dasharray="3 4"' : ''} opacity="0">` +
    `<animate attributeName="opacity" values=".75;0" begin="${clock(-age)}" dur="${clock(GLOW_MS / 2)}" fill="freeze"/></line>`
  )
}

/** How far from the core a leg bends, by how many stations apart its ends are: far enough in to clear the labels under the nodes, far enough out to clear the core. */
const BEND = [0.5, 0.5, 0.4, 0.45, 0.55, 0.75]

/** The way from one station to another: a curve through the room between the core and the ring. */
function leg(i: number, j: number): { path: string; end: Point } {
  const n = STATIONS.length
  let steps = (((j - i) % n) + n) % n
  if (steps > n / 2) steps -= n
  const bend = at(turn(i + steps / 2), BEND[Math.abs(steps)] ?? 0.5)
  const a = edge(place(i), bend, NODE + 4)
  const b = edge(place(j), bend, NODE + 4)
  return { path: `M${n1(a.x)} ${n1(a.y)}Q${n1(bend.x)} ${n1(bend.y)} ${n1(b.x)} ${n1(b.y)}`, end: b }
}

/** The stations the main loop went through, oldest first, a station visited twice in a row counted once. */
export function routeOf(entries: readonly Entry[], max = TRAIL_STOPS): { station: StationId; at: number }[] {
  const stops: { station: StationId; at: number }[] = []
  for (const e of entries) {
    if (e.from === 'agents' || e.station === 'model') continue
    const last = stops[stops.length - 1]
    if (last !== undefined && last.station === e.station) last.at = e.startedAt
    else stops.push({ station: e.station, at: e.startedAt })
  }
  return stops.slice(-max)
}

function trail(entries: readonly Entry[], now: number, c: Palette): string {
  const stops = routeOf(entries)
  let out = ''
  for (let k = 1; k < stops.length; k++) {
    const from = stops[k - 1]
    const to = stops[k]
    if (from === undefined || to === undefined) continue
    const { path, end } = leg(indexOf(from.station), indexOf(to.station))
    const isHead = k === stops.length - 1
    const age = now - to.at
    if (age >= TRAIL_HOLD_MS + TRAIL_FADE_MS) continue
    const opacity = n1(0.12 + (0.5 * k) / (stops.length - 1))
    // The fading is written into the drawing, so a leg goes out on time even when nothing redraws the map.
    const fade = `<animate attributeName="opacity" values="${opacity};0" begin="${clock(TRAIL_HOLD_MS - age)}" dur="${clock(TRAIL_FADE_MS)}" fill="freeze"/>`
    // The newest leg draws itself; the rest are already there.
    const drawing = isHead
      ?` pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" values="1;0" begin="${clock(to.at - now)}" dur=".5s" fill="freeze"/>`
      : '>'
    out += `<path d="${path}" fill="none" stroke="${c.trail}" stroke-width="${isHead ? 1.5 : 1.1}" stroke-linecap="round" opacity="${opacity}"${drawing}${fade}</path>`
    if (isHead) {
      out +=
        `<circle cx="${n1(end.x)}" cy="${n1(end.y)}" r="2.4" fill="${c.trail}" opacity="0">` +
        `<animate attributeName="opacity" values="0;.85" begin="${clock(to.at - now + 400)}" dur=".15s" fill="freeze"/>` +
        `<animate attributeName="opacity" values=".85;0" begin="${clock(TRAIL_HOLD_MS - age)}" dur="${clock(TRAIL_FADE_MS)}" fill="freeze"/></circle>`
    }
  }
  return out
}

type Scene = {
  entries: Entry[]
  board: Board
  now: number
  c: Palette
  names: typeof WORDS.stations
}

function station(s: (typeof STATIONS)[number], i: number, { entries, board, now, c, names }: Scene): { under: string; over: string } {
  const p = place(i)
  const x = n1(p.x)
  const y = n1(p.y)
  const count = board.counts[s.id] ?? 0
  const own = entries.filter(e => e.station === s.id)
  const running = own.filter(e => e.status === 'run')
  const latest = own.length > 0 ? own[own.length - 1] : undefined
  const since = latest === undefined ? Infinity : now - (latest.endedAt ?? latest.startedAt)
  const alarm = own.filter(e => e.status === 'block' || e.status === 'err').pop()
  const alarmAge = alarm === undefined ? Infinity : now - (alarm.endedAt ?? alarm.startedAt)
  const isAlarm = alarmAge < ALARM_MS
  const isLit = running.length > 0 || since < GLOW_MS
  const [main, hot] = s.id === 'memory' ? [c.mem, c.memHot] : [c.accent, c.hot]
  const color = isAlarm ? c.red : main
  const fade = isAlarm ? alarmAge : since
  const span = isAlarm ? ALARM_MS : GLOW_MS

  let under = ''
  if (isLit || isAlarm) {
    under +=
      running.length > 0 && !isAlarm
        ? `<circle cx="${x}" cy="${y}" r="${NODE + 10}" fill="${color}" opacity=".16"/>`
        : `<circle cx="${x}" cy="${y}" r="${NODE + 10}" fill="${color}" opacity="0">` +
          `<animate attributeName="opacity" values=".3;0" begin="${clock(-fade)}" dur="${clock(span)}" fill="freeze"/></circle>`
  }
  if (running.length > 0) {
    const elapsed = now - Math.min(...running.map(e => e.startedAt))
    const beat = `begin="${clock(-(elapsed % 1400))}" dur="1.4s" repeatCount="indefinite"`
    // The beat is a ring that spreads.
    under +=
      `<circle cx="${x}" cy="${y}" r="${NODE}" fill="none" stroke="${color}" stroke-width="1.3">` +
      `<animate attributeName="r" values="${NODE};${NODE + 15}" ${beat}/>` +
      `<animate attributeName="opacity" values=".9;0" ${beat}/></circle>`
    // Two hands of a clock around the node: the inner one goes round in a minute, the outer one in ten.
    const hand = (r: number, width: number, lapMs: number, isOnce: boolean): string =>
      `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${hot}" stroke-width="${width}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" transform="rotate(-90 ${x} ${y})">` +
      `<animate attributeName="stroke-dashoffset" values="1;0" begin="${clock(-(isOnce ? Math.min(elapsed, lapMs) : elapsed % lapMs))}" dur="${clock(lapMs)}" ${isOnce ? 'fill="freeze"' : 'repeatCount="indefinite"'}/></circle>`
    under += hand(NODE + 4, 2.2, 60_000, false) + hand(NODE + 8, 1.2, 600_000, true)
  }

  // A lit node wears a ring of its color while something runs; afterwards the ring fades back to the resting line.
  const lit = `<circle cx="${x}" cy="${y}" r="${NODE}" fill="none" stroke="${color}" stroke-width="1.2"`
  const cooling =
    running.length > 0
      ? `${lit}/>`
      : isLit || isAlarm
        ? `${lit} opacity="0"><animate attributeName="opacity" values="1;0" begin="${clock(-fade)}" dur="${clock(span)}" fill="freeze"/></circle>`
        : ''
  const glyphColor = isAlarm ? c.red : isLit ? hot : s.id === 'memory' && count > 0 ? main : c.ash
  // The words stand on a rim of the ground's own color, so a line that passes behind them never strikes them through.
  const rim = `paint-order="stroke" stroke="${c.ground}" stroke-width="3.5" stroke-linejoin="round"`
  let over =
    `<circle cx="${x}" cy="${y}" r="${NODE}" fill="${c.raised}" stroke="${c.line}" stroke-width="1.2"/>${cooling}` +
    `<path transform="translate(${x} ${y}) scale(1.3)" d="${s.icon}" fill="none" stroke="${glyphColor}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="${x}" y="${n1(p.y + NODE + 18)}" text-anchor="middle" ${FONT} font-size="16" font-weight="600" ${rim} fill="${c.bone}">${names[s.id]}</text>`

  if (count > 0) {
    // Memory keeps two counts: what was asked for, and what a hook brought down unasked.
    const pushed = s.id === 'memory' ? Math.min(count, board.pushed ?? 0) : 0
    const asked = count - pushed
    const figures =
      pushed === 0 ? String(count) : `${asked > 0 ? `${asked} ` : ''}<tspan fill="${main}">↓${pushed}</tspan>`
    over += `<text x="${x}" y="${n1(p.y + NODE + 35)}" text-anchor="middle" ${FONT} font-size="13" ${rim} fill="${c.ash}">${figures}</text>`
  }

  // Top right: how many run at once. Top left: what went wrong since the last message, until the next one.
  const corner = NODE * 0.74
  if (running.length > 1) {
    over +=
      `<circle cx="${n1(p.x + corner)}" cy="${n1(p.y - corner)}" r="9.5" fill="${c.raised}" stroke="${color}" stroke-width="1"/>` +
      `<text x="${n1(p.x + corner)}" y="${n1(p.y - corner + 3.5)}" text-anchor="middle" ${FONT} font-size="10" fill="${hot}">×${running.length}</text>`
  }
  const faults = board.faults?.[s.id] ?? 0
  if (faults > 0) {
    over +=
      `<circle cx="${n1(p.x - corner)}" cy="${n1(p.y - corner)}" r="9" fill="${c.red}"/>` +
      `<text x="${n1(p.x - corner)}" y="${n1(p.y - corner + 3.7)}" text-anchor="middle" ${FONT} font-size="10.5" font-weight="700" fill="${c.ground}">${faults > 99 ? '99+' : faults}</text>`
  }
  return { under, over }
}

/** How tall baby Narsil stands in the core, in the drawing's units. */
const NARSIL_HEIGHT = 96

/** Baby Narsil at the core: the light picture, swapped for the dark one where the surface is dark, clipped to the circle. */
function narsilAtCore(narsil: Narsil): string {
  const box = { width: Math.max(narsil.light.width, narsil.dark.width), height: Math.max(narsil.light.height, narsil.dark.height) }
  const scale = NARSIL_HEIGHT / box.height
  const left = CX - (box.width * scale) / 2
  const top = CY - NARSIL_HEIGHT / 2 + 3
  const image = (art: Art, theme: string): string =>
    `<image class="${theme}" href="${art.src}" x="${n1(left + ((box.width - art.width) * scale) / 2)}" y="${n1(top + (box.height - art.height) * scale)}" width="${n1(art.width * scale)}" height="${n1(art.height * scale)}" clip-path="url(#core)"/>`
  return (
    `<style>.oscuro{display:none}@media (prefers-color-scheme: dark){.claro{display:none}.oscuro{display:inline}}</style>` +
    `<clipPath id="core"><circle cx="${CX}" cy="${CY}" r="${CORE - 1}"/></clipPath>` +
    image(narsil.light, 'claro') +
    image(narsil.dark, 'oscuro')
  )
}

/**
 * The board as one SVG, baby Narsil at its core: the first of her pictures that keeps the drawing within what the
 * Svg element accepts. When none does, the core says NARSIL instead: the map always shows.
 */
export function drawMap(board: Board, now: number, narsil: readonly Narsil[] = []): string {
  for (const art of narsil) {
    const drawn = drawWith(board, now, art)
    if (drawn.length <= SVG_LIMIT) return drawn
  }
  return drawWith(board, now, undefined)
}

/** What the map says to a reader that cannot see it: what runs now and how full the context is. */
export function describeMap(board: Board): string {
  const running = board.entries.filter(e => e.status === 'run')
  const top = running[running.length - 1]
  const context = board.context === undefined ? '' : ` · ${WORDS.context} ${Math.round(board.context)}%`
  const now = top === undefined ? WORDS.idle : `${WORDS.stations[top.station]}: ${top.label}${running.length > 1 ? WORDS.andMore(running.length - 1) : ''}`
  return `${WORDS.section}. ${now}${context}`
}

function drawWith(board: Board, now: number, narsil: Narsil | undefined): string {
  const c: Palette = DARK
  const core: Point = { x: CX, y: CY }
  const recent = board.entries.slice(-40)
  const flights = recent.filter(e => now - e.startedAt < PULSE_MS + RIPPLE_MS).slice(-14)
  const returns = recent.filter(e => e.endedAt !== undefined && e.from !== 'inbound' && now - e.endedAt < PULSE_MS + RIPPLE_MS).slice(-14)
  const beams = recent.filter(e => now - e.startedAt < GLOW_MS / 2).slice(-10)
  const anyRunning = recent.some(e => e.status === 'run')
  const agentsAt = place(indexOf('agents'))
  const isBad = (e: Entry): boolean => e.status === 'block' || e.status === 'err'
  const tone = (e: Entry): [string, string] => (e.station === 'memory' ? [c.mem, c.memHot] : [c.accent, c.hot])

  // No ground of its own: the pane shows through, and the rim around the words is the pane's color.
  let body = ''

  // Contours around the core.
  for (const [rx, ry] of [[76, 72], [110, 103], [144, 134]]) {
    body += `<ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${ry}" fill="none" stroke="${c.line}" stroke-width=".7" opacity=".45" stroke-dasharray="2 5"/>`
  }

  // Spokes first, then whatever flies along them, then the nodes on top.
  // A spoke wears in with use: by the end of a session the map shows where the work went.
  STATIONS.forEach((s, i) => {
    const p = place(i)
    const a = edge(core, p, HUB)
    const b = edge(p, core, NODE)
    const worn = Math.min(1, Math.log2(1 + (board.counts[s.id] ?? 0)) / 7)
    const line = `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke-width="${n1(1 + 2.6 * worn)}" stroke-linecap="round"`
    body += `${line} stroke="${c.spoke}"/>`
    if (worn > 0) body += `${line} stroke="${s.id === 'memory' ? c.mem : c.accent}" opacity="${n1(worn * 0.55)}"/>`
  })

  const scene: Scene = { entries: recent, board, now, c, names: WORDS.stations }
  const drawn = STATIONS.map((s, i) => station(s, i, scene))
  body += drawn.map(d => d.under).join('')
  body += trail(recent, now, c)

  /** The two ends of an entry's spoke: where it starts (the core or the agents station) and its own station. */
  const ends = (e: Entry): [Point, Point] => {
    const p = place(indexOf(e.station))
    const start = e.from === 'agents' ? agentsAt : core
    return [edge(start, p, e.from === 'agents' ? NODE : HUB), edge(p, start, NODE)]
  }
  /** Pulses that share a spoke and a moment fly in lanes, five apart. */
  const lane = (list: Entry[], e: Entry): number => {
    const peers = list.filter(x => x.station === e.station && x.from === e.from)
    return (peers.indexOf(e) - (peers.length - 1) / 2) * 5
  }

  for (const e of beams) {
    const [a, b] = ends(e)
    body += beam(a, b, isBad(e) ? c.red : tone(e)[0], now - e.startedAt, e.from === 'inbound')
  }
  for (const e of flights) {
    const [a, b] = aside(...ends(e), lane(flights, e))
    const age = now - e.startedAt
    const color = e.status === 'block' ? c.red : tone(e)[1]
    if (e.from === 'inbound') {
      body += pulse(b, a, color, age, 3.8, true) + ripple(core, HUB - 2, color, age)
    } else {
      body += pulse(a, b, color, age, 3.8) + ripple(place(indexOf(e.station)), NODE, color, age)
    }
  }
  for (const e of returns) {
    const [a, b] = aside(...ends(e), lane(returns, e))
    body += pulse(b, a, e.status === 'ok' ? c.ash : c.red, now - (e.endedAt as number), 2.6)
  }

  body += drawn.map(d => d.over).join('')

  // Each subagent still at work circles the agents station.
  const crew = (board.agents ?? []).slice(0, 6)
  crew.forEach((_, k) => {
    const lap = 7000
    const spin = `${n1(agentsAt.x)} ${n1(agentsAt.y)}`
    body +=
      `<g><animateTransform attributeName="transform" type="rotate" from="0 ${spin}" to="360 ${spin}" begin="${clock(-((now + (k * lap) / crew.length) % lap))}" dur="${clock(lap)}" repeatCount="indefinite"/>` +
      `<circle cx="${n1(agentsAt.x)}" cy="${n1(agentsAt.y - NODE - 6)}" r="3" fill="${c.hot}"/></g>`
  })

  // The core breathes at rest and quickens while something runs.
  const period = anyRunning ? 1600 : 4800
  const breath = `begin="${clock(-(now % period))}" dur="${clock(period)}" repeatCount="indefinite"`
  body +=
    `<circle cx="${CX}" cy="${CY}" r="${CORE + 6}" fill="${c.accent}" opacity=".08">` +
    `<animate attributeName="r" values="${CORE + 3};${CORE + 13};${CORE + 3}" ${breath}/>` +
    `<animate attributeName="opacity" values=".05;${anyRunning ? '.24' : '.12'};.05" ${breath}/></circle>` +
    `<circle cx="${CX}" cy="${CY}" r="${CORE}" fill="${c.raised}" stroke="${anyRunning ? c.accent : c.line}" stroke-width="1.3"/>` +
    // A soft blue under Narsil, so her light picture stands out on a light pane.
    `<circle cx="${CX}" cy="${CY}" r="${CORE - 1}" fill="${c.accent}" opacity=".14"/>`

  // Baby Narsil stands in the core; without the pictures, her name does.
  body +=
    narsil !== undefined
      ? narsilAtCore(narsil)
      : `<text x="${CX}" y="${CY + 5}" text-anchor="middle" ${FONT} font-size="16" letter-spacing="2.4" fill="${c.bone}">NARSIL</text>`

  // The context window as a ring around the core: it fills as the session goes and empties at a compaction.
  const full = board.context === undefined ? undefined : Math.max(0, Math.min(100, Math.round(board.context)))
  if (full !== undefined) {
    const ring = `cx="${CX}" cy="${CY}" r="${CORE + 5}" fill="none" stroke-width="2.2"`
    body +=
      `<circle ${ring} stroke="${c.line}" opacity=".7"/>` +
      `<circle ${ring} stroke="${full >= 90 ? c.red : full >= 70 ? c.accent : c.ash}" pathLength="100" stroke-dasharray="${full} 100" transform="rotate(-90 ${CX} ${CY})"/>`
  }

  // Under the core, where Narsil leaves no room inside it: the model and how full the context is.
  const switchAge = board.switchedAt === undefined ? Infinity : now - board.switchedAt
  const isSwitching = switchAge >= 0 && switchAge < SWITCH_MS
  const figures = [board.model === undefined ? '' : escapeXml(shortModel(board.model)), full === undefined ? '' : `${full}%`].filter(Boolean).join(' · ')
  if (figures !== '') {
    const rim = `paint-order="stroke" stroke="${c.ground}" stroke-width="3.5" stroke-linejoin="round"`
    body += `<text x="${CX}" y="${CY + CORE + 22}" text-anchor="middle" ${FONT} font-size="13" ${rim} fill="${isSwitching ? c.hot : c.ash}">${figures}</text>`
  }

  // A changed model rings at the core and at its station for a few seconds.
  if (isSwitching) {
    const model = place(indexOf('model'))
    const laps = Math.ceil((SWITCH_MS - switchAge) / 1600)
    for (const [p, r] of [[core, CORE], [model, NODE]] as const) {
      const ringing = `begin="${clock(-(switchAge % 1600))}" dur="1.6s" repeatCount="${laps}" fill="freeze"`
      body +=
        `<circle cx="${n1(p.x)}" cy="${n1(p.y)}" r="${r}" fill="none" stroke="${c.bone}" stroke-width="1.4" opacity="0">` +
        `<animate attributeName="r" values="${r};${r + 26}" ${ringing}/>` +
        `<animate attributeName="opacity" values=".7;0" ${ringing}/></circle>`
    }
  }

  // The answer leaves the core as one wide ring.
  const done = recent.filter(e => e.mark === 'done').pop()
  if (done !== undefined && now - done.startedAt < DONE_MS) {
    const leaving = `begin="${clock(done.startedAt - now)}" dur="${clock(DONE_MS)}" fill="freeze"`
    body +=
      `<circle cx="${CX}" cy="${CY}" r="${CORE}" fill="none" stroke="${c.bone}" stroke-width="1.6" opacity="0">` +
      `<animate attributeName="r" values="${CORE};${CORE + 38}" ${leaving}/>` +
      `<animate attributeName="opacity" values=".6;0" ${leaving}/></circle>`
  }

  // Twice the viewBox, so the picture fills whatever room the pane gives it.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">${lightRules()}${body}</svg>`
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string)
}

// The words of the work map, from lot-map's Spanish table (https://github.com/alexeyw/lot-map,
// MIT, Copyright (c) 2026 Aleksei Volodin). Only the ones this port shows.
import type { MapBoard, StationId } from '../../types'
import { PALETTE } from '../words'

export const WORDS = {
  section: 'Mapa',
  stations: {
    you: 'Tú',
    model: 'Modelo',
    memory: 'Memoria',
    files: 'Archivos',
    shell: 'Terminal',
    web: 'Red',
    browser: 'Navegador',
    agents: 'Agentes',
    skills: 'Skills',
    hooks: 'Hooks',
  } satisfies Record<StationId, string>,
  newMessage: 'mensaje nuevo',
  answerReady: 'respuesta lista',
  turnAborted: 'turno interrumpido',
  step: (n: number) => `paso ${n}`,
  subagent: 'subagente',
  compacting: 'compactando el contexto',
  addedContext: (when: string) => `añadió contexto ${when}`,
  toMessage: 'al mensaje',
  atStart: 'al iniciar la sesión',
  stopped: (tool: string) => `detuvo ${tool}`,
  askedPermission: (tool: string) => `pidió permiso: ${tool}`,
  checkBefore: (tool: string) => `comprobación antes de ${tool}`,
  idle: 'No hay nada en ejecución.',
  context: 'contexto',
  andMore: (n: number) => ` y ${n} más`,
  webSearch: 'búsqueda web',
  artifact: 'artefacto',
  workflow: 'flujo de trabajo',
  skill: 'skill',
  loadingTools: 'cargando herramientas',
  questionForYou: 'pregunta para ti',
  fileForYou: 'archivo para ti',
}

/** The section's toggle, as every section's: its arrow and its name. */
export const mapLabel = (isOpen: boolean): string => `${isOpen ? '▾' : '▸'} ${WORDS.section}`

/** The section's color, in Narsil's palette: red after something went wrong, blue while work runs, green at rest. */
export function mapTone(board: MapBoard): string {
  if (Object.values(board.faults ?? {}).some(n => (n ?? 0) > 0)) return PALETTE.error
  return board.entries.some(e => e.status === 'run') ? PALETTE.info : PALETTE.done
}

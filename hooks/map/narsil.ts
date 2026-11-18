import type { MapBoard } from '../../types'
import { ANIMADA_PARADA_CLARO, ANIMADA_PARADA_OSCURO, ANIMADA_TRABAJANDO_CLARO, ANIMADA_TRABAJANDO_OSCURO } from '../narsil-anim'
import { PARADA_CLARO, PARADA_OSCURO, TRABAJANDO_CLARO, TRABAJANDO_OSCURO } from '../narsil-art'
import type { Narsil } from './draw'

const ASLEEP: readonly Narsil[] = [
  { light: ANIMADA_PARADA_CLARO, dark: ANIMADA_PARADA_OSCURO },
  { light: PARADA_CLARO, dark: PARADA_OSCURO },
]
const AWAKE: readonly Narsil[] = [
  { light: ANIMADA_TRABAJANDO_CLARO, dark: ANIMADA_TRABAJANDO_OSCURO },
  { light: TRABAJANDO_CLARO, dark: TRABAJANDO_OSCURO },
]

/** Whether anything on the board is running: baby Narsil is awake for it. */
export const isWorking = (board: MapBoard): boolean => board.entries.some(e => e.status === 'run')

/**
 * Baby Narsil for the map's core: asleep while nothing runs, awake while work does. Her animated loop comes first
 * and her still picture after it, for when the loop would take the drawing past what Svg accepts.
 */
export const narsilFor = (board: MapBoard): readonly Narsil[] => (isWorking(board) ? AWAKE : ASLEEP)

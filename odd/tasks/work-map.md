# Work map

Objective: a live, animated map of Claude's work as the first section of Narsil Check, ported from lot-map (MIT, Aleksei Volodin), with baby Narsil at its center.
Branch: `claude/lot-map-functionality-d7bbda` · Delivery: `ask-on-risk` · Tests: `claude plugin test .`, type-check with tsc, `claude plugin validate .`

## Specs

- **S1** The user's request: "mira este mod, quisiera traer la funcionalidad aca, como lo ves? https://github.com/alexeyw/lot-map", then "lo que propones traer ya lo tengo en narsilPet, me interesa traer es el mapa animado".
- **S2** The accepted plan: port the classification and the drawing with attribution, as a collapsible `▸ Mapa` section, desktop surfaces only (no terminal picture or braille), in Narsil's colors. The user: "sí, avanza con ese plan, la seccion mapa va a ir de primeras, quita la imagen de narsil bebe y ponlo ahi, ya que es la misma imagen que ira creo que sera un buen reemplazo".
- **S3** Baby Narsil leaves the top of the pane and stands at the center of the map, in place of lot-map's "CLAUDE" label.
- Assumptions: no user options (lot-map's `userConfig` is not ported); Spanish labels only, from lot-map's `es` table; the feed of rows, `contextCost`, the terminal map and the zoom buttons are not ported; the section opens at each session start; on a surface without `Svg` the section is not shown.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S2 | inline | pending | |
| T2 | S1, S2 | inline | pending | |
| T3 | S2, S3 | inline | pending | |
| T4 | S2, S3 | inline | pending | |
| T5 | S2 | inline | pending | |

T1: `hooks/map/` stations, Spanish words and classification, with tests. T2: the board atom and the event hooks that fill it. T3: the SVG drawing in Narsil's palette with baby Narsil at the core, kept under the Svg size limit. T4: the `Mapa` section first in the pane, the top picture removed. T5: README credit and LICENSE notice for lot-map, version bump.

Route evidence: no writer trigger (one behavior, the units depend on each other); inline.

## Log

- **L1** (2026-11-18) User: the S1 and S2 messages above.
- **L2** lot-map 0.10.0 read: the map is one SVG with SMIL animation redrawn on each board change (`hooks/draw.ts`), stations from `hooks/classify.ts`, state in one atom (`hooks/board.ts`). The Svg element takes at most 131072 characters; baby Narsil's two PNGs are about 88 KB, so the map must keep room for them.

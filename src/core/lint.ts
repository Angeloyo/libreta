// Geometry checks. Exact, so the agent doesn't have to eyeball a screenshot for overlaps.
// Each problem says what to do about it.

import { routeArrow } from './arrows.ts'
import { contains, inflate, intersects, pathHitsRect } from './geometry.ts'
import { isSolid, type Board, type Rect, type Shape } from './model.ts'
import { missingGlyphs, shapeText, textArea } from './text.ts'

export interface Problem {
  ids: string[]
  message: string
}

const endId = (end: Shape['from']) => (end && 'id' in end ? end.id : undefined)

export function lint(board: Board): Problem[] {
  const problems: Problem[] = []
  const solids = board.shapes.filter(isSolid)
  const frames = board.shapes.filter((s) => s.kind === 'frame')

  // Solid shapes on top of each other (unless the human arranged both that way). Only siblings:
  // shapes in different frames overlap only if their frames do, which is reported below.
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const [a, b] = [solids[i], solids[j]]
      if (a.parent !== b.parent || (a.by === 'human' && b.by === 'human')) continue
      if (intersects(a, b, 4)) problems.push({ ids: [a.id, b.id], message: `${a.id} and ${b.id} overlap — move one, e.g. move ${b.id} below=${a.id}` })
    }
  }

  // Shapes and frames that overlap a sibling frame they aren't part of.
  for (const frame of frames) {
    for (const s of [...solids, ...frames]) {
      if (s === frame || s.parent !== frame.parent || (s.by === 'human' && frame.by === 'human')) continue
      if (s.kind === 'frame' && s.id < frame.id) continue // report each frame pair once
      if (!intersects(s, frame, 4)) continue
      problems.push(
        s.kind === 'frame'
          ? { ids: [frame.id, s.id], message: `frames ${frame.id} and ${s.id} overlap — move one of them` }
          : { ids: [s.id, frame.id], message: `${s.id} overlaps frame ${frame.id} but isn't in it — move ${s.id} in=${frame.id}, or move it clear` },
      )
    }
  }

  // Text that doesn't fit a shape with a fixed size.
  for (const s of solids) {
    if (s.auto || !s.text) continue
    const block = shapeText(s)
    const area = textArea(s)
    if (block.height > area.h + 2) {
      problems.push({ ids: [s.id], message: `text in ${s.id} doesn't fit — make it taller (h ≥ ${Math.ceil(s.h + block.height - area.h)}) or shorten it` })
    }
  }

  // Characters the font can't draw show up as blank space.
  for (const s of board.shapes) {
    const missing = missingGlyphs(s.text)
    if (missing.length) problems.push({ ids: [s.id], message: `${s.id} uses characters the board's font can't draw (${missing.join(' ')}) — they show as blank; use plain text` })
  }

  // Arrows that cut through shapes, and labels sitting on shapes or on each other.
  const labels: { id: string; rect: Rect }[] = []
  for (const arrow of board.shapes.filter((s) => s.kind === 'arrow')) {
    const ends = new Set([endId(arrow.from), endId(arrow.to)])
    const route = routeArrow(board, arrow)
    if (route.label) {
      const clash = labels.find((l) => intersects(l.rect, route.label!, 2))
      if (clash) problems.push({ ids: [clash.id, arrow.id], message: `the labels of ${clash.id} and ${arrow.id} overlap — shorten one, or give the shapes more room` })
      labels.push({ id: arrow.id, rect: route.label })
    }
    const name = `${arrow.id} (${endId(arrow.from) ?? 'point'} -> ${endId(arrow.to) ?? 'point'})`
    for (const s of solids) {
      if (!ends.has(s.id) && pathHitsRect(route.points, inflate(s, -2))) {
        problems.push({ ids: [arrow.id, s.id], message: `arrow ${name} passes through ${s.id} — move a shape to clear the path` })
      }
      if (route.label && intersects(route.label, s, 2) && !contains(s, route.label)) {
        problems.push({ ids: [arrow.id, s.id], message: `label of ${name} overlaps ${s.id} — leave more room between the shapes it connects` })
      }
    }
  }
  return problems
}

/** Problems that involve any of `ids` (including arrows attached to them). */
export function lintAround(board: Board, ids: Set<string>): Problem[] {
  const involved = new Set(ids)
  for (const s of board.shapes) {
    if (s.kind === 'arrow' && [endId(s.from), endId(s.to)].some((e) => e && ids.has(e))) involved.add(s.id)
  }
  return lint(board).filter((p) => p.ids.some((id) => involved.has(id)))
}

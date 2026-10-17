// What's under the pointer. Frames are only "hit" on their title bar and border, so dragging
// inside a frame selects what's in it instead of grabbing the whole frame.

import { routeArrow } from '../../core/arrows.ts'
import { inflate, type Point } from '../../core/geometry.ts'
import type { Board, Rect, Shape } from '../../core/model.ts'
import { drawOrder } from '../../core/render.ts'
import { titleBand } from '../../core/text.ts'

const inside = (r: Rect, [x, y]: Point) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function hitShape(board: Board, shape: Shape, p: Point, tolerance: number): boolean {
  if (shape.kind === 'arrow') {
    const { points, label } = routeArrow(board, shape)
    if (label && inside(label, p)) return true
    for (let i = 1; i < points.length; i++) if (distanceToSegment(p, points[i - 1], points[i]) <= tolerance) return true
    return false
  }
  if (shape.kind === 'frame') {
    const outer = inflate(shape, tolerance)
    const inner = inflate(shape, -tolerance)
    const title = { x: shape.x, y: shape.y, w: shape.w, h: titleBand(shape) }
    return inside(title, p) || (inside(outer, p) && !inside(inner, p))
  }
  return inside(inflate(shape, tolerance / 2), p)
}

/** The topmost shape at a point. */
export function shapeAt(board: Board, p: Point, tolerance: number, skip?: (s: Shape) => boolean): Shape | undefined {
  const order = drawOrder(board)
  for (let i = order.length - 1; i >= 0; i--) {
    const s = order[i]
    if (skip?.(s)) continue
    if (hitShape(board, s, p, tolerance)) return s
  }
}

/** The innermost frame containing a point (for dropping shapes into frames). */
export function frameAt(board: Board, p: Point, skip: Set<string>): Shape | undefined {
  const order = drawOrder(board)
  for (let i = order.length - 1; i >= 0; i--) {
    const s = order[i]
    if (s.kind === 'frame' && !skip.has(s.id) && inside(s, p)) return s
  }
}

/** Shapes fully inside a marquee rectangle. */
export function shapesIn(board: Board, r: Rect): Shape[] {
  return board.shapes.filter((s) => {
    if (s.kind === 'arrow') {
      const { points } = routeArrow(board, s)
      return points.every((p) => inside(r, p))
    }
    return inside(r, [s.x, s.y]) && inside(r, [s.x + s.w, s.y + s.h])
  })
}

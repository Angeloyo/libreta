// What a pen stroke means, in words: circling shapes, crossing one out, underlining it, a line
// between two shapes, or just a mark near one. Freehand has no text, so this is how the agent
// knows the human crossed out "q5" instead of just "drew a pen stroke".

import { center, inflate, pathLength, type Point } from './geometry.ts'
import { isSolid, type Board, type Rect, type Shape } from './model.ts'

const within = (r: Rect, [x, y]: Point) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

function inPolygon([x, y]: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** How many times the stroke turns back along one axis (0 = x, 1 = y). */
function turns(pts: Point[], axis: 0 | 1): number {
  let count = 0
  let dir = 0
  let anchor = pts[0][axis]
  for (const p of pts) {
    const d = p[axis] - anchor
    if (Math.abs(d) < 8) continue // ignore jitter
    const now = Math.sign(d)
    if (dir && now !== dir) count++
    dir = now
    anchor = p[axis]
  }
  return count
}

/** A zig-zag turns back several times, left/right or up/down. */
const reversals = (pts: Point[]) => Math.max(turns(pts, 0), turns(pts, 1))

export function penMeaning(board: Board, pen: Shape): string | undefined {
  const pts: Point[] = (pen.points ?? []).map(([x, y]) => [x + pen.x, y + pen.y])
  if (pts.length < 2) return undefined
  const solids = board.shapes.filter((s) => isSolid(s))
  const [start, end] = [pts[0], pts[pts.length - 1]]
  const straight = Math.hypot(end[0] - start[0], end[1] - start[1]) / (pathLength(pts) || 1) // 1 = a straight line
  const closed = Math.hypot(start[0] - end[0], start[1] - end[1]) < Math.max(30, 0.3 * Math.max(pen.w, pen.h))

  if (closed) {
    const circled = solids.filter((s) => inPolygon(center(s), pts))
    if (circled.length) return `circles ${circled.map((s) => s.id).join(', ')}`
  }
  for (const s of solids) {
    const over = pts.filter((p) => within(s, p)).length / pts.length
    if (over > 0.7) {
      if (reversals(pts) >= 3) return `crosses out ${s.id}`
      if (straight > 0.85) return `strikes through ${s.id}`
      return `scribbled on ${s.id}`
    }
    // A flat line just under a shape, along most of its width.
    const flat = pen.h < 0.35 * pen.w && straight > 0.8
    const alongside = Math.min(pen.x + pen.w, s.x + s.w) - Math.max(pen.x, s.x) > 0.5 * Math.min(pen.w, s.w)
    if (flat && alongside && pen.y + pen.h / 2 > s.y + s.h - 15 && pen.y + pen.h / 2 < s.y + s.h + 35) return `underlines ${s.id}`
  }
  const at = (p: Point) => solids.find((s) => within(inflate(s, 24), p))
  const [a, b] = [at(start), at(end)]
  if (a && b && a !== b) return `line from ${a.id} to ${b.id}`
  const [cx, cy] = center(pen)
  const nearest = solids
    .map((s) => ({ s, d: Math.hypot(center(s)[0] - cx, center(s)[1] - cy) }))
    .sort((p, q) => p.d - q.d)[0]
  if (nearest && nearest.d < 250) return `near ${nearest.s.id}`
}

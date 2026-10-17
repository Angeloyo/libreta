// Arrow paths are never stored: they're computed from the shapes an arrow connects.
// Straight when the way is clear, otherwise the shortest elbow route around obstacles.

import { boundaryPoint, center, inflate, intersects, pathHitsRect, pathLength, pointAlong, type Point } from './geometry.ts'
import { getShape, isSolid, type Board, type End, type Rect, type Shape } from './model.ts'
import { shapeText } from './text.ts'

const GAP = 6 // space between an arrow tip and the shape it points at
const STUB = 24 // how far an elbow route travels out of a shape before turning
const BEND_COST = 40
const PARALLEL = 30 // distance between arrows that join the same two shapes

export interface Route {
  points: Point[]
  /** Where the label sits, when the arrow has text. */
  label?: Rect
}

/** The shape an end is attached to, if any. */
export function endShape(board: Board, end: End | undefined): Shape | undefined {
  return end && 'id' in end ? getShape(board, end.id) : undefined
}

function endPoint(board: Board, end: End | undefined): Point {
  if (!end) return [0, 0]
  if ('x' in end) return [end.x, end.y]
  const shape = getShape(board, end.id)
  return shape ? center(shape) : [0, 0]
}

/** Arrows joining the same two shapes are spread apart so they don't draw on top of each other. */
function parallelOffset(board: Board, arrow: Shape, a: Shape, b: Shape): number {
  const pair = (s: Shape) => {
    const x = endShape(board, s.from)?.id
    const y = endShape(board, s.to)?.id
    return x && y ? [x, y].sort().join('|') : ''
  }
  const key = [a.id, b.id].sort().join('|')
  const siblings = board.shapes.filter((s) => s.kind === 'arrow' && pair(s) === key)
  if (siblings.length < 2) return 0
  return (siblings.indexOf(arrow) - (siblings.length - 1) / 2) * PARALLEL
}

export function routeArrow(board: Board, arrow: Shape): Route {
  const a = endShape(board, arrow.from)
  const b = endShape(board, arrow.to)
  let pa = endPoint(board, arrow.from)
  let pb = endPoint(board, arrow.to)
  if (a && b) {
    // Shift both ends sideways (perpendicular to the line between them), seen from a fixed direction.
    const offset = parallelOffset(board, arrow, a, b)
    if (offset) {
      const [p, q] = a.id < b.id ? [pa, pb] : [pb, pa]
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
      const [nx, ny] = [(-(q[1] - p[1]) / len) * offset, ((q[0] - p[0]) / len) * offset]
      pa = [pa[0] + nx, pa[1] + ny]
      pb = [pb[0] + nx, pb[1] + ny]
    }
  }
  const start = a ? boundaryPoint(a, pb, GAP, pa) : pa
  const end = b ? boundaryPoint(b, pa, GAP, pb) : pb
  const straight: Point[] = [start, end]

  const obstacles = board.shapes
    .filter((s) => isSolid(s) && s.id !== a?.id && s.id !== b?.id)
    .map((s) => inflate(s, 4))
  const clear = (points: Point[]) => !obstacles.some((o) => pathHitsRect(points, o))

  let points = straight
  if (a && b && !clear(straight)) {
    const ends = [inflate(a, 1), inflate(b, 1)]
    const routes = elbowRoutes(a, b).filter((r) => clear(r) && !ends.some((e) => pathHitsRect(r, e)))
    routes.sort((r1, r2) => cost(r1) - cost(r2))
    if (routes[0]) points = routes[0]
  }
  // Parallel arrows put their labels at different points along the way, so they don't stack.
  const offset = a && b ? parallelOffset(board, arrow, a, b) : 0
  let along = offset ? 0.5 + Math.sign(offset) * 0.18 : 0.5
  if (a && b && a.id > b.id) along = 1 - along // measured from the same end for both directions
  return { points, label: labelRect(arrow, points, obstacles, along) }
}

function cost(points: Point[]): number {
  return pathLength(points) + (points.length - 2) * BEND_COST
}

/**
 * The label goes at the middle of the path. If that covers a shape, it tries other spots
 * along the path, then beside the line instead of on it.
 */
function labelRect(arrow: Shape, points: Point[], obstacles: Rect[], along = 0.5): Rect | undefined {
  if (!arrow.text) return undefined
  const block = shapeText(arrow)
  const w = block.width + 12
  const h = block.height + 4
  const length = pathLength(points)
  const candidates: Rect[] = []
  for (const t of [along, along - 0.1, along + 0.1, along - 0.2, along + 0.2].filter((t) => t > 0.1 && t < 0.9)) {
    const [x, y] = pointAlong(points, length * t)
    const [ax, ay] = pointAlong(points, Math.max(0, length * t - 1))
    const [bx, by] = pointAlong(points, Math.min(length, length * t + 1))
    const vertical = Math.abs(by - ay) > Math.abs(bx - ax)
    const side = vertical ? [w / 2 + 6, 0] : [0, h / 2 + 4]
    for (const k of [0, 1, -1]) candidates.push({ x: x + k * side[0] - w / 2, y: y + k * side[1] - h / 2, w, h })
  }
  return candidates.find((r) => !obstacles.some((o) => intersects(r, o))) ?? candidates[0]
}

type Side = 'top' | 'right' | 'bottom' | 'left'
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const DIR: Record<Side, Point> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }

/** Middle of a side, just outside the shape. */
function port(r: Rect, side: Side): Point {
  const [cx, cy] = center(r)
  if (side === 'top') return [cx, r.y - GAP]
  if (side === 'bottom') return [cx, r.y + r.h + GAP]
  if (side === 'left') return [r.x - GAP, cy]
  return [r.x + r.w + GAP, cy]
}

const horizontal = (s: Side) => s === 'left' || s === 'right'

/** Every one- and two-bend route between the sides of a and b. */
function elbowRoutes(a: Rect, b: Rect): Point[][] {
  const routes: Point[][] = []
  for (const sa of SIDES) {
    for (const sb of SIDES) {
      const p = port(a, sa)
      const q = port(b, sb)
      const [dax, day] = DIR[sa]
      const [dbx, dby] = DIR[sb]
      if (horizontal(sa) !== horizontal(sb)) {
        // L: one bend. The corner must lie outward from both ports.
        const corner: Point = horizontal(sa) ? [q[0], p[1]] : [p[0], q[1]]
        const outA = (corner[0] - p[0]) * dax + (corner[1] - p[1]) * day
        const outB = (corner[0] - q[0]) * dbx + (corner[1] - q[1]) * dby
        if (outA > 0 && outB > 0) routes.push([p, corner, q])
        continue
      }
      // Z or U: two bends on a line between (or beyond) the two ports.
      const axis = horizontal(sa) ? 0 : 1
      let line: number
      if (sa !== sb) {
        line = (p[axis] + q[axis]) / 2
        // The middle line must be outward from both ports, or the route doubles back.
        if ((line - p[axis]) * (dax + day) < STUB || (line - q[axis]) * (dbx + dby) < STUB) continue
      } else {
        const outward = dax + day // +1 for right/bottom, -1 for left/top
        line = outward > 0 ? Math.max(p[axis], q[axis]) + STUB : Math.min(p[axis], q[axis]) - STUB
      }
      routes.push(axis === 0 ? [p, [line, p[1]], [line, q[1]], q] : [p, [p[0], line], [q[0], line], q])
    }
  }
  return routes
}

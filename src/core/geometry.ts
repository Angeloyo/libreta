import type { Kind, Rect } from './model.ts'

export type Point = [number, number]

export const center = (r: Rect): Point => [r.x + r.w / 2, r.y + r.h / 2]

export function inflate(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }
}

/** True when the rectangles overlap by more than `slack` pixels in both directions. */
export function intersects(a: Rect, b: Rect, slack = 0): boolean {
  return a.x + a.w - slack > b.x && b.x + b.w - slack > a.x && a.y + a.h - slack > b.y && b.y + b.h - slack > a.y
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

export function overlap(a: Rect, b: Rect): { w: number; h: number } {
  return {
    w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
  }
}

export function union(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const x2 = Math.max(...rects.map((r) => r.x + r.w))
  const y2 = Math.max(...rects.map((r) => r.y + r.h))
  return { x, y, w: x2 - x, h: y2 - y }
}

/** Does the segment p→q pass through the rectangle? (Liang–Barsky clipping.) */
export function segmentHitsRect(p: Point, q: Point, r: Rect): boolean {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, p[0] - r.x],
    [dx, r.x + r.w - p[0]],
    [-dy, p[1] - r.y],
    [dy, r.y + r.h - p[1]],
  ]
  for (const [pe, qe] of edges) {
    if (pe === 0) {
      if (qe < 0) return false
      continue
    }
    const t = qe / pe
    if (pe < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

export function pathHitsRect(points: Point[], r: Rect): boolean {
  for (let i = 1; i < points.length; i++) if (segmentHitsRect(points[i - 1], points[i], r)) return true
  return false
}

/**
 * Where a ray from `from` (a point inside the shape, default its center) toward `toward`
 * leaves the shape's outline, pushed `gap` pixels further out. Boxes, ellipses and diamonds.
 */
export function boundaryPoint(shape: Rect & { kind: Kind }, toward: Point, gap = 0, from: Point = center(shape)): Point {
  const [cx, cy] = center(shape)
  const [px, py] = from
  let dx = toward[0] - px
  let dy = toward[1] - py
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const a = shape.w / 2
  const b = shape.h / 2
  const [ox, oy] = [px - cx, py - cy] // start, relative to the center
  let t = Infinity
  if (shape.kind === 'ellipse') {
    const A = (dx / a) ** 2 + (dy / b) ** 2
    const B = 2 * ((ox * dx) / a ** 2 + (oy * dy) / b ** 2)
    const C = (ox / a) ** 2 + (oy / b) ** 2 - 1
    t = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A)
  } else if (shape.kind === 'diamond') {
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        const denom = (sx * dx) / a + (sy * dy) / b
        if (denom > 0) t = Math.min(t, (1 - (sx * ox) / a - (sy * oy) / b) / denom)
      }
    }
  } else {
    if (dx) t = Math.min(t, ((dx > 0 ? a : -a) - ox) / dx)
    if (dy) t = Math.min(t, ((dy > 0 ? b : -b) - oy) / dy)
  }
  if (!isFinite(t) || t < 0) t = 0
  return [px + dx * (t + gap), py + dy * (t + gap)]
}

export function pathLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return total
}

/** The point `dist` pixels along a polyline. */
export function pointAlong(points: Point[], dist: number): Point {
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const seg = Math.hypot(bx - ax, by - ay)
    if (dist <= seg && seg > 0) return [ax + ((bx - ax) * dist) / seg, ay + ((by - ay) * dist) / seg]
    dist -= seg
  }
  return points[points.length - 1]
}

export const round10 = (n: number) => Math.round(n / 10) * 10

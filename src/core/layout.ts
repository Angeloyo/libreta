// Placement: where shapes go when the agent describes intent instead of coordinates.
// Frames with a layout arrange their children; everything else is placed relative to
// another shape or in the nearest free spot, never on top of something.

import { inflate, intersects, round10, union, type Point } from './geometry.ts'
import { childrenOf, getShape, type Board, type Rect, type Shape } from './model.ts'
import { contentTop, fontSizeOf, FRAME_PAD, layoutText, textWidth } from './text.ts'

export const GAP = 40 // default distance between neighbours
const MARGIN = 30 // free space kept around a shape placed in an empty spot
const STEP = 20

export type Side = 'right' | 'left' | 'above' | 'below'
export type Align = 'start' | 'center' | 'end'

/** Moves a shape, and everything inside it when it's a frame. */
export function moveTo(board: Board, shape: Shape, x: number, y: number): void {
  const dx = x - shape.x
  const dy = y - shape.y
  if (!dx && !dy) return
  for (const s of [shape, ...descendants(board, shape.id)]) {
    s.x += dx
    s.y += dy
  }
}

export function descendants(board: Board, id: string): Shape[] {
  const out: Shape[] = []
  for (const child of childrenOf(board, id)) out.push(child, ...descendants(board, child.id))
  return out
}

/** The shapes a placed shape must keep clear of: its siblings in the same frame (or on the board). */
function obstacles(board: Board, shape: Shape): Rect[] {
  const inside = new Set(descendants(board, shape.id).map((s) => s.id))
  return board.shapes.filter(
    (s) => s !== shape && s.parent === shape.parent && !inside.has(s.id) && s.kind !== 'arrow' && s.kind !== 'pen',
  )
}

export function isFree(board: Board, shape: Shape, margin = 0): boolean {
  const r = inflate(shape, margin)
  return !obstacles(board, shape).some((o) => intersects(r, o))
}

/** Places `shape` beside `target`, then (with `slide`) moves it further out until it overlaps nothing. */
export function placeBeside(board: Board, shape: Shape, target: Rect, side: Side, gap = GAP, align: Align = 'center', slide = true): void {
  const cross = (start: number, size: number, own: number) =>
    align === 'start' ? start : align === 'end' ? start + size - own : start + (size - own) / 2
  let x = 0
  let y = 0
  if (side === 'right' || side === 'left') {
    x = side === 'right' ? target.x + target.w + gap : target.x - gap - shape.w
    y = cross(target.y, target.h, shape.h)
  } else {
    y = side === 'below' ? target.y + target.h + gap : target.y - gap - shape.h
    x = cross(target.x, target.w, shape.w)
  }
  moveTo(board, shape, round10(x), round10(y))
  if (!slide) return
  const [dx, dy] = { right: [1, 0], left: [-1, 0], below: [0, 1], above: [0, -1] }[side]
  for (let i = 0; i < 500 && !isFree(board, shape, 10); i++) moveTo(board, shape, shape.x + dx * STEP, shape.y + dy * STEP)
}

/**
 * Places `shape` next to `target` on whichever side has room (right, below, left, above).
 * With a `label` (an arrow that will join them), the gap leaves room to read it.
 */
export function placeNear(board: Board, shape: Shape, target: Rect, gap = GAP, label?: string): void {
  const gapFor = (side: Side) => {
    if (!label) return gap
    return Math.max(gap, side === 'right' || side === 'left' ? Math.ceil((textWidth(label, 16) + 56) / 10) * 10 : 70)
  }
  for (const side of ['right', 'below', 'left', 'above'] as Side[]) {
    placeBeside(board, shape, target, side, gapFor(side), 'center', false)
    if (isFree(board, shape, 10)) return
  }
  placeBeside(board, shape, target, 'right', gapFor('right'))
}

/** Centers `shape` on the free spot closest to `anchor`, searching outward in rings. */
export function placeInFreeSpot(board: Board, shape: Shape, anchor: Point): void {
  const [ax, ay] = anchor
  for (let ring = 0; ring < 150; ring++) {
    const r = ring * STEP
    const spots: Point[] = []
    for (let d = -r; d <= r; d += STEP) {
      spots.push([d, -r], [d, r])
      if (Math.abs(d) !== r) spots.push([-r, d], [r, d])
    }
    spots.sort((p, q) => Math.hypot(...p) - Math.hypot(...q))
    for (const [dx, dy] of spots) {
      moveTo(board, shape, round10(ax + dx - shape.w / 2), round10(ay + dy - shape.h / 2))
      if (isFree(board, shape, MARGIN)) return
      if (r === 0) break
    }
  }
}

/** Where new content should go when the agent gives no position: right of everything. */
export function defaultAnchor(board: Board, shape: Shape): Point {
  if (shape.parent) {
    const frame = getShape(board, shape.parent)
    if (frame) return [frame.x + FRAME_PAD + shape.w / 2, frame.y + contentTop(frame) + shape.h / 2]
  }
  const content = union(board.shapes.filter((s) => !s.parent && s !== shape && s.kind !== 'arrow'))
  if (!content) return [shape.w / 2 + 100, shape.h / 2 + 100]
  return [content.x + content.w + 80 + shape.w / 2, content.y + shape.h / 2]
}

// ---- Frames ----

const titleWidth = (frame: Shape) => (frame.text ? textWidth(frame.text, fontSizeOf(frame), true) + 28 : 0)

/** Arranges a layout frame's children in a row, column or grid, and sizes the frame to hug them. */
export function layoutFrame(board: Board, frame: Shape): void {
  const kids = childrenOf(board, frame.id).filter((s) => s.kind !== 'arrow' && s.kind !== 'pen')
  if (frame.layout === 'table') return layoutTable(board, frame, kids)
  const gap = frame.spacing ?? GAP
  const pad = FRAME_PAD
  const top = contentTop(frame)
  if (!kids.length) {
    frame.w = Math.max(frame.w, titleWidth(frame), 200)
    frame.h = Math.max(frame.h, top + pad)
    return
  }
  // Auto-sized boxes in a column share one width (rows: one height), which reads as a stack.
  const boxes = kids.filter((k) => k.kind === 'box' && k.auto === 'size')
  if (frame.layout === 'col' && boxes.length > 1) for (const b of boxes) b.w = Math.max(...boxes.map((k) => k.w))
  if (frame.layout === 'row' && boxes.length > 1) for (const b of boxes) b.h = Math.max(...boxes.map((k) => k.h))

  const maxW = Math.max(...kids.map((k) => k.w))
  const maxH = Math.max(...kids.map((k) => k.h))
  let innerW = 0
  let innerH = 0
  if (frame.layout === 'col') {
    innerW = Math.max(maxW, titleWidth(frame) - 2 * pad)
    let y = frame.y + top
    kids.forEach((k, i) => {
      moveTo(board, k, frame.x + pad + (innerW - k.w) / 2, y)
      y += k.h + Math.max(gap, labelRoom(board, k, kids[i + 1], 'col'))
    })
    innerH = y - gap - (frame.y + top)
  } else if (frame.layout === 'row') {
    let x = frame.x + pad
    kids.forEach((k, i) => {
      moveTo(board, k, x, frame.y + top + (maxH - k.h) / 2)
      x += k.w + Math.max(gap, labelRoom(board, k, kids[i + 1], 'row'))
    })
    innerW = Math.max(x - gap - (frame.x + pad), titleWidth(frame) - 2 * pad)
    innerH = maxH
  } else {
    const cols = frame.cols ?? Math.ceil(Math.sqrt(kids.length))
    kids.forEach((k, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      moveTo(board, k, frame.x + pad + col * (maxW + gap) + (maxW - k.w) / 2, frame.y + top + row * (maxH + gap) + (maxH - k.h) / 2)
    })
    const rows = Math.ceil(kids.length / cols)
    innerW = Math.max(Math.min(cols, kids.length) * (maxW + gap) - gap, titleWidth(frame) - 2 * pad)
    innerH = rows * (maxH + gap) - gap
  }
  frame.w = innerW + 2 * pad
  frame.h = top + innerH + pad
}

const CELL_PAD_X = 32 // matches a box's text padding, so cell text wraps where the renderer wraps it
const CELL_PAD_Y = 20

/**
 * A table: cells fill rows of `cols`. Each column is as wide as its widest cell, each row as
 * tall as its tallest, and cells stretch to fill their slot. The frame hugs the grid.
 */
function layoutTable(board: Board, frame: Shape, cells: Shape[]): void {
  const cols = frame.cols ?? 1
  const rows = Math.ceil(cells.length / cols)
  const block = (c: Shape, width: number) => layoutText(c.text, fontSizeOf(c), width)
  const natural = cells.map((c) => (c.auto ? block(c, 14 * fontSizeOf(c)).width + CELL_PAD_X : c.w))
  const colW = Array.from({ length: cols }, (_, j) => Math.ceil(Math.max(60, ...natural.filter((_, i) => i % cols === j))))
  const height = (c: Shape, i: number) => (c.auto ? block(c, colW[i % cols] - CELL_PAD_X).height + CELL_PAD_Y : c.h)
  const rowH = Array.from({ length: rows }, (_, r) => Math.ceil(Math.max(30, ...cells.map((c, i) => (Math.floor(i / cols) === r ? height(c, i) : 0)))))
  const top = frame.text ? contentTop(frame) : 0
  cells.forEach((c, i) => {
    const [r, j] = [Math.floor(i / cols), i % cols]
    if (c.auto) [c.w, c.h] = [colW[j], rowH[r]]
    moveTo(board, c, frame.x + colW.slice(0, j).reduce((a, b) => a + b, 0), frame.y + top + rowH.slice(0, r).reduce((a, b) => a + b, 0))
  })
  frame.w = Math.max(colW.reduce((a, b) => a + b, 0), titleWidth(frame))
  frame.h = top + rowH.reduce((a, b) => a + b, 0)
}

/** Space needed between two neighbours so the label of an arrow joining them stays readable. */
export function labelRoom(board: Board, a: Shape, b: Shape | undefined, axis: 'col' | 'row'): number {
  if (!b) return 0
  const linked = (end: Shape['from'], id: string) => end && 'id' in end && end.id === id
  let room = 0
  for (const s of board.shapes) {
    if (s.kind !== 'arrow' || !s.text) continue
    if (!((linked(s.from, a.id) && linked(s.to, b.id)) || (linked(s.from, b.id) && linked(s.to, a.id)))) continue
    room = Math.max(room, axis === 'col' ? 64 : textWidth(s.text, 16) + 56)
  }
  return Math.ceil(room / 10) * 10
}

/** Makes a free-form frame hug its children exactly (the `fit` op). */
export function hug(board: Board, frame: Shape): void {
  const content = union(childrenOf(board, frame.id).filter((s) => s.kind !== 'arrow'))
  if (!content) return
  frame.x = content.x - FRAME_PAD
  frame.y = content.y - contentTop(frame)
  frame.w = Math.max(content.w + 2 * FRAME_PAD, titleWidth(frame))
  frame.h = content.h + contentTop(frame) + FRAME_PAD
}

/** Grows a free-form frame so its children fit inside it. Frames never shrink on their own. */
export function fitFrame(board: Board, frame: Shape): void {
  const kids = childrenOf(board, frame.id).filter((s) => s.kind !== 'arrow')
  const content = union(kids)
  if (!content) return
  const x = Math.min(frame.x, content.x - FRAME_PAD)
  const y = Math.min(frame.y, content.y - contentTop(frame))
  const x2 = Math.max(frame.x + frame.w, content.x + content.w + FRAME_PAD, x + titleWidth(frame))
  const y2 = Math.max(frame.y + frame.h, content.y + content.h + FRAME_PAD)
  Object.assign(frame, { x, y, w: x2 - x, h: y2 - y })
}

function depth(board: Board, shape: Shape): number {
  let d = 0
  for (let p = shape.parent; p; p = getShape(board, p)?.parent) d++
  return d
}

/** Lays out every frame, innermost first, so outer frames see their children's final sizes. */
export function settle(board: Board): void {
  const frames = board.shapes.filter((s) => s.kind === 'frame').sort((a, b) => depth(board, b) - depth(board, a))
  for (const frame of frames) {
    if (frame.layout && frame.layout !== 'none') layoutFrame(board, frame)
    else fitFrame(board, frame)
  }
}

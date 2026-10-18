// The board document. Shapes carry meaning (ids, parent frame, layout intent, author),
// and arrows only reference the shapes they connect: their path is computed when drawn.

export type Kind = 'box' | 'ellipse' | 'diamond' | 'text' | 'sticky' | 'frame' | 'arrow' | 'pen'
export type Color = 'black' | 'grey' | 'blue' | 'violet' | 'green' | 'yellow' | 'orange' | 'red' | 'pink'
export type Fill = 'none' | 'light' | 'solid'
export type Stroke = 'solid' | 'dashed' | 'dotted'
export type Size = 's' | 'm' | 'l' | 'xl'
export type Layout = 'none' | 'row' | 'col' | 'grid' | 'table'
export type Heads = 'end' | 'both' | 'none'
export type Author = 'human' | 'agent'

/** An arrow end: attached to a shape, or a free point on the board. */
export type End = { id: string } | { x: number; y: number }

export interface Shape {
  id: string
  kind: Kind
  /** Absolute board position and size. Unused for arrows (their path is derived). */
  x: number
  y: number
  w: number
  h: number
  text: string
  color: Color
  fill: Fill
  stroke: Stroke
  size: Size
  /** The frame this shape lives in. */
  parent?: string
  /**
   * How the size follows the text: 'size' (width and height), 'height' (the width was set,
   * the height grows to fit). Unset: someone chose both, so the size is fixed.
   */
  auto?: 'size' | 'height'
  /** Frames: how children are arranged. */
  layout?: Layout
  spacing?: number
  cols?: number
  /** Arrows. */
  from?: End
  to?: End
  heads?: Heads
  /** Pen strokes: [x, y, pressure] relative to the shape's x/y. */
  points?: number[][]
  /** Who created the shape. */
  by: Author
  /** Placed by hand: layout and the agent's placement never move it. */
  pinned?: boolean
}

/** One field-level change to one shape. */
export interface Change {
  id: string
  type: 'add' | 'update' | 'remove'
  before?: Partial<Shape>
  after?: Partial<Shape>
  /** For removals: where the shape was in the list (its draw and layout order). */
  index?: number
}

/** Everything one apply() did: one undo step, one entry in the log. */
export interface Changeset {
  rev: number
  by: Author
  /** Which agent, when `by` is 'agent' (e.g. "claude"). */
  agent?: string
  label?: string
  at: number
  changes: Change[]
}

export interface Board {
  name: string
  rev: number
  shapes: Shape[]
  /** Recent changesets, newest last. Capped at LOG_LIMIT. */
  log: Changeset[]
}

export const LOG_LIMIT = 2000

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const COLORS: Record<Color, { stroke: string; light: string; solid: string }> = {
  black: { stroke: '#1e1e1e', light: '#f1f3f5', solid: '#ced4da' },
  grey: { stroke: '#6b7280', light: '#f3f4f6', solid: '#d1d5db' },
  blue: { stroke: '#2563eb', light: '#dbeafe', solid: '#93c5fd' },
  violet: { stroke: '#7c3aed', light: '#ede9fe', solid: '#c4b5fd' },
  green: { stroke: '#15803d', light: '#dcfce7', solid: '#86efac' },
  yellow: { stroke: '#a16207', light: '#fef9c3', solid: '#fde047' },
  orange: { stroke: '#c2410c', light: '#ffedd5', solid: '#fdba74' },
  red: { stroke: '#dc2626', light: '#fee2e2', solid: '#fca5a5' },
  pink: { stroke: '#db2777', light: '#fce7f3', solid: '#f9a8d4' },
}

export const FONT_SIZE: Record<Size, number> = { s: 16, m: 20, l: 28, xl: 40 }

export function emptyBoard(name: string): Board {
  return { name, rev: 0, shapes: [], log: [] }
}

export function getShape(board: Board, id: string): Shape | undefined {
  return board.shapes.find((s) => s.id === id)
}

export function childrenOf(board: Board, frameId: string): Shape[] {
  return board.shapes.filter((s) => s.parent === frameId)
}

/** Shapes that take up space: everything except arrows, frames and pen strokes. */
export function isSolid(shape: Shape): boolean {
  return shape.kind !== 'arrow' && shape.kind !== 'frame' && shape.kind !== 'pen'
}

/** Next free generated id for a prefix: b1, b2, ... */
export function nextId(board: Board, prefix: string): string {
  let n = 1
  while (getShape(board, prefix + n)) n++
  return prefix + n
}

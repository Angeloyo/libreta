// The engine: applies a batch of ops to a board as one atomic changeset.
// Ops say what and where (relative); this file turns that into exact positions.

import { center } from './geometry.ts'
import { defaultAnchor, descendants, hug, moveTo, placeBeside, placeInFreeSpot, placeNear, settle, type Side } from './layout.ts'
import { getShape, LOG_LIMIT, nextId, type Author, type Board, type Change, type Changeset, type End, type Rect, type Shape } from './model.ts'
import type { ConnectOp, CreateOp, MoveOp, Op, UpdateOp } from './ops.ts'
import { didYouMean } from './suggest.ts'
import { autoSize, contentTop, fitHeight, fontSizeOf, textWidth } from './text.ts'

export interface ApplyContext {
  by: Author
  /** The agent's name, recorded in the history. */
  agent?: string
  label?: string
  /** The rev the agent last saw. Fields the human changed after it are not overwritten. */
  baseRev?: number
  /** Where the human is looking: new shapes without a position go there. */
  view?: Rect
  now?: number
  /** How errors name an op, e.g. "line 3". Default "op 3". */
  where?: (i: number) => string
}

export interface ApplyResult {
  ok: boolean
  board: Board
  changeset?: Changeset
  /** Things the caller should know: cascaded deletes, skipped fields. */
  notes: string[]
  errors: string[]
}

const PREFIX: Record<string, string> = { box: 'b', ellipse: 'e', diamond: 'd', text: 't', sticky: 'n', frame: 'f', pen: 'p', arrow: 'a' }

class OpError extends Error {}

export function apply(board: Board, ops: Op[], ctx: ApplyContext): ApplyResult {
  const next: Board = { ...board, shapes: structuredClone(board.shapes) }
  const run = new Run(next, ops, ctx)
  const errors: string[] = []
  ops.forEach((op, i) => {
    try {
      run.do(op)
    } catch (e) {
      if (!(e instanceof OpError)) throw e
      errors.push(`${ctx.where ? ctx.where(i) : `op ${i + 1}`} (${op.op}): ${e.message}`)
    }
  })
  if (errors.length) return { ok: false, board, notes: [], errors }

  settle(next)
  // Relative placements were made before frames finished growing: make them again, now that
  // every frame has its final size.
  if (run.placeAgain()) settle(next)
  const changes = diff(board.shapes, next.shapes)
  if (!changes.length) return { ok: true, board, notes: [...run.notes, 'nothing changed'], errors: [] }

  const changeset: Changeset = { rev: board.rev + 1, by: ctx.by, agent: ctx.agent, label: ctx.label, at: ctx.now ?? Date.now(), changes }
  next.rev = changeset.rev
  next.log = [...board.log, changeset].slice(-LOG_LIMIT)
  return { ok: true, board: next, changeset, notes: run.notes, errors: [] }
}

/** State for one apply() call. */
class Run {
  notes: string[] = []
  private lastPlaced?: Shape
  private relative: [Shape, CreateOp | MoveOp][] = []
  private humanTouched: Map<string, Set<string>>
  private board: Board
  private ops: Op[]
  private ctx: ApplyContext

  constructor(board: Board, ops: Op[], ctx: ApplyContext) {
    this.board = board
    this.ops = ops
    this.ctx = ctx
    this.humanTouched = ctx.by === 'agent' && ctx.baseRev !== undefined ? touchedSince(board, ctx.baseRev) : new Map()
  }

  do(op: Op): void {
    if (op.op === 'create') this.create(op)
    else if (op.op === 'connect') this.connect(op)
    else if (op.op === 'update') this.update(op)
    else if (op.op === 'move') this.move(op)
    else this.delete(op.id)
  }

  private get(id: string): Shape {
    const shape = getShape(this.board, id)
    if (!shape) throw new OpError(`no shape "${id}"${didYouMean(id, this.board.shapes.map((s) => s.id))}`)
    return shape
  }

  private frame(id: string): Shape {
    const frame = this.get(id)
    if (frame.kind !== 'frame') throw new OpError(`"${id}" is a ${frame.kind}, not a frame — only frames can contain shapes`)
    return frame
  }

  private create(op: CreateOp): void {
    const id = op.id ?? nextId(this.board, PREFIX[op.kind])
    const existing = getShape(this.board, id)
    if (existing) throw new OpError(`id "${id}" is taken by ${existing.kind} "${existing.text}" — pick another id, or use update`)
    const shape: Shape = {
      id,
      kind: op.kind,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      text: op.text ?? '',
      color: op.color ?? (op.kind === 'sticky' ? 'yellow' : op.kind === 'frame' ? 'grey' : 'black'),
      fill: op.fill ?? 'none',
      stroke: op.stroke ?? 'solid',
      size: op.size ?? 'm',
      by: this.ctx.by,
    }
    if (op.kind === 'frame') {
      shape.layout = op.layout ?? 'none'
      if (op.spacing !== undefined) shape.spacing = op.spacing
      if (op.cols !== undefined) shape.cols = op.cols
    }
    if (op.kind === 'pen') setPoints(shape, op.points ?? [])
    else this.size(shape, op.w, op.h)
    if (op.in) shape.parent = this.frame(op.in).id

    const sibling = op.after ?? op.before
    if (sibling) {
      const at = this.board.shapes.indexOf(this.get(sibling))
      this.board.shapes.splice(op.after ? at + 1 : at, 0, shape)
      if (op.in === undefined) shape.parent = this.get(sibling).parent
    } else this.board.shapes.push(shape)

    if (op.kind !== 'pen') this.position(shape, op)
  }

  /**
   * Sizes a shape. No w/h: the size follows the text. Only w: the height follows the text.
   * Only h: the width stays. Both: fixed.
   */
  private size(shape: Shape, w?: number, h?: number): void {
    if (shape.kind === 'frame') {
      shape.w = w ?? Math.max(shape.w, 320, textWidth(shape.text, fontSizeOf(shape), true) + 60)
      shape.h = h ?? Math.max(shape.h, contentTop(shape) + 160)
      return
    }
    if (w && h) [shape.w, shape.h, shape.auto] = [w, h, undefined]
    else if (w) {
      shape.w = w
      shape.auto = 'height'
      shape.h = fitHeight(shape)
    } else if (h) {
      if (!shape.w) shape.w = autoSize(shape).w
      shape.h = h
      shape.auto = undefined
    } else {
      Object.assign(shape, autoSize(shape))
      shape.auto = 'size'
    }
  }

  /**
   * After the text or font size changed: grow or shrink to fit if the size follows the text.
   * A fixed-size shape keeps its size, but grows taller rather than cutting the text off.
   */
  private refit(shape: Shape): void {
    if (shape.auto === 'size') Object.assign(shape, autoSize(shape))
    else if (shape.auto === 'height') shape.h = fitHeight(shape)
    else if (shape.kind !== 'frame') shape.h = Math.max(shape.h, fitHeight(shape))
  }

  /** Puts a shape where the op asks: exact spot, beside another shape, its frame's layout, or a free spot. */
  private position(shape: Shape, op: CreateOp | MoveOp): void {
    const parent = shape.parent ? getShape(this.board, shape.parent) : undefined
    const arranged = parent?.layout && parent.layout !== 'none'
    const side = SIDES.find((k) => op[k])
    if (arranged && (op.at || side)) {
      throw new OpError(
        `"${parent!.id}" arranges its children (layout=${parent!.layout}); use after/before to order them, or update ${parent!.id} layout=none`,
      )
    }
    if (op.at) moveTo(this.board, shape, op.at[0], op.at[1])
    else if (side) {
      if (op[side] === shape.id) throw new OpError(`a shape can't be placed relative to itself`)
      this.placeRelative(shape, op)
      this.relative.push([shape, op])
    } else if (!arranged) {
      if (op.op === 'move') return
      const partner = this.partnerOf(shape)
      if (partner) placeNear(this.board, shape, partner.shape, undefined, partner.label)
      else if (this.lastPlaced && this.lastPlaced.parent === shape.parent) placeBeside(this.board, shape, this.lastPlaced, 'right')
      else placeInFreeSpot(this.board, shape, this.anchor(shape))
    }
    this.lastPlaced = shape
  }

  private placeRelative(shape: Shape, op: CreateOp | MoveOp, board = this.board): void {
    const side = SIDES.find((k) => op[k])!
    const target = this.get(op[side]!)
    if (side === 'near') placeNear(board, shape, target, op.gap)
    else placeBeside(board, shape, target, SIDE[side], op.gap, op.align)
  }

  /** Redoes this batch's relative placements, in order. Returns whether there were any. */
  placeAgain(): boolean {
    const family = (s: Shape) => [s.id, ...descendants(this.board, s.id).map((d) => d.id)]
    // Shapes still waiting for their turn don't block the ones placed before them.
    const waiting = new Set(this.relative.flatMap(([s]) => family(s)))
    for (const [shape, op] of this.relative) {
      if (getShape(this.board, shape.id) !== shape) continue
      for (const id of family(shape)) waiting.delete(id)
      this.placeRelative(shape, op, { ...this.board, shapes: this.board.shapes.filter((s) => !waiting.has(s.id)) })
    }
    return this.relative.length > 0
  }

  /** An existing shape that a later op in this batch connects `shape` to: place them together. */
  private partnerOf(shape: Shape): { shape: Shape; label?: string } | undefined {
    for (const op of this.ops) {
      if (op.op !== 'connect') continue
      const other = op.from === shape.id ? op.to : op.to === shape.id ? op.from : undefined
      if (typeof other === 'string') {
        const s = getShape(this.board, other)
        if (s && s !== shape && s.w > 0 && s.parent === shape.parent) return { shape: s, label: op.text }
      }
    }
  }

  private anchor(shape: Shape): [number, number] {
    if (!shape.parent && this.ctx.view) return center(this.ctx.view)
    return defaultAnchor(this.board, shape)
  }

  private end(ref: string | [number, number]): End {
    if (typeof ref !== 'string') return { x: ref[0], y: ref[1] }
    const shape = this.get(ref)
    if (shape.kind === 'arrow') throw new OpError(`"${ref}" is an arrow; arrows connect shapes, not other arrows`)
    return { id: shape.id }
  }

  private connect(op: ConnectOp): void {
    const id = op.id ?? nextId(this.board, 'a')
    if (getShape(this.board, id)) throw new OpError(`id "${id}" is taken — pick another id`)
    if (typeof op.from === 'string' && op.from === op.to) throw new OpError(`an arrow needs two different ends`)
    this.board.shapes.push({
      id,
      kind: 'arrow',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      text: op.text ?? '',
      color: op.color ?? 'black',
      fill: 'none',
      stroke: op.stroke ?? 'solid',
      size: op.size ?? 'm',
      from: this.end(op.from),
      to: this.end(op.to),
      heads: op.heads ?? 'end',
      by: this.ctx.by,
    })
  }

  private update(op: UpdateOp): void {
    const shape = this.get(op.id)
    const fields = { ...op } as Record<string, unknown>
    delete fields.op
    delete fields.id
    for (const key of Object.keys(fields)) {
      if (fields[key] !== undefined && this.isHumans(shape, key)) {
        this.notes.push(`skipped ${shape.id}.${key}: the human changed it since you last looked (now ${JSON.stringify(shape[key as keyof Shape])})`)
        delete fields[key]
      }
    }
    const { w, h, from, to, points, fit, ...rest } = fields as Partial<UpdateOp>
    const textChanged = rest.text !== undefined && rest.text !== shape.text
    const sizeChanged = rest.size !== undefined && rest.size !== shape.size
    for (const [key, value] of Object.entries(rest)) if (value !== undefined) (shape as unknown as Record<string, unknown>)[key] = value
    if (from !== undefined) shape.from = this.end(from)
    if (to !== undefined) shape.to = this.end(to)
    if (points !== undefined && shape.kind === 'pen') setPoints(shape, points)
    if (shape.kind === 'arrow' || shape.kind === 'pen') return
    if (fit) {
      if (shape.kind !== 'frame') throw new OpError(`fit is for frames; ${shape.id} is a ${shape.kind}`)
      hug(this.board, shape)
      return
    }
    if (w || h) this.size(shape, w, h)
    else if (textChanged || sizeChanged) this.refit(shape)
  }

  private move(op: MoveOp): void {
    const shape = this.get(op.id)
    if (shape.kind === 'arrow') throw new OpError(`arrows follow the shapes they connect; use update ${shape.id} from=... to=... instead`)
    if (this.isHumans(shape, 'x') || this.isHumans(shape, 'y')) {
      this.notes.push(`skipped moving ${shape.id}: the human moved it since you last looked`)
      return
    }
    const before = { x: shape.x, y: shape.y }
    if (op.in !== undefined) {
      if (op.in === null) delete shape.parent
      else {
        const frame = this.frame(op.in)
        if (frame === shape || descendants(this.board, shape.id).includes(frame)) throw new OpError(`"${shape.id}" can't go inside itself`)
        shape.parent = frame.id
      }
    }
    const sibling = op.after ?? op.before
    if (sibling) {
      const target = this.get(sibling)
      this.board.shapes.splice(this.board.shapes.indexOf(shape), 1)
      const at = this.board.shapes.indexOf(target)
      this.board.shapes.splice(op.after ? at + 1 : at, 0, shape)
      if (op.in === undefined) shape.parent = target.parent
    }
    if (op.by) moveTo(this.board, shape, shape.x + op.by[0], shape.y + op.by[1])
    else this.position(shape, op)
    const parent = shape.parent ? getShape(this.board, shape.parent) : undefined
    const arranged = parent?.layout && parent.layout !== 'none'
    if (this.ctx.by === 'human' && !arranged && (shape.x !== before.x || shape.y !== before.y)) shape.pinned = true
  }

  private delete(id: string): void {
    const shape = this.get(id)
    if (this.ctx.by === 'agent' && this.humanTouched.has(id)) {
      this.notes.push(`skipped deleting ${id}: the human changed it since you last looked`)
      return
    }
    const doomed = new Set([shape.id, ...descendants(this.board, shape.id).map((s) => s.id)])
    for (const s of this.board.shapes) {
      const attached = [s.from, s.to].some((e) => e && 'id' in e && doomed.has(e.id))
      if (s.kind === 'arrow' && attached && !doomed.has(s.id)) {
        doomed.add(s.id)
        this.notes.push(`also removed arrow ${s.id} (it was attached to ${id})`)
      }
    }
    const inside = [...doomed].filter((d) => d !== id && getShape(this.board, d)?.kind !== 'arrow')
    if (inside.length) this.notes.push(`also removed ${inside.join(', ')} (inside ${id})`)
    this.board.shapes = this.board.shapes.filter((s) => !doomed.has(s.id))
  }

  private isHumans(shape: Shape, field: string): boolean {
    return this.humanTouched.get(shape.id)?.has(field) ?? false
  }
}

const SIDES = ['right_of', 'left_of', 'above', 'below', 'near'] as const
const SIDE: Record<string, Side> = { right_of: 'right', left_of: 'left', above: 'above', below: 'below' }

/** Pen points come in absolute; the shape stores them relative to its top-left corner. */
function setPoints(shape: Shape, points: number[][]): void {
  if (!points.length) throw new OpError('a pen stroke needs points: [[x, y], ...]')
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  shape.x = Math.min(...xs)
  shape.y = Math.min(...ys)
  shape.w = Math.max(1, Math.max(...xs) - shape.x)
  shape.h = Math.max(1, Math.max(...ys) - shape.y)
  shape.points = points.map(([x, y, p]) => [x - shape.x, y - shape.y, p ?? 0.5])
}

/** Which fields of which shapes the human changed after `rev`. */
function touchedSince(board: Board, rev: number): Map<string, Set<string>> {
  const touched = new Map<string, Set<string>>()
  for (const cs of board.log) {
    if (cs.rev <= rev || cs.by !== 'human') continue
    for (const change of cs.changes) {
      const fields = touched.get(change.id) ?? new Set<string>()
      for (const key of Object.keys(change.after ?? change.before ?? {})) fields.add(key)
      touched.set(change.id, fields)
    }
  }
  return touched
}

/** Field-level differences between two versions of the shape list. */
export function diff(before: Shape[], after: Shape[]): Change[] {
  const changes: Change[] = []
  const old = new Map(before.map((s) => [s.id, s]))
  const now = new Map(after.map((s) => [s.id, s]))
  for (const s of after) {
    const prev = old.get(s.id)
    if (!prev) {
      changes.push({ id: s.id, type: 'add', after: s })
      continue
    }
    const b: Record<string, unknown> = {}
    const a: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(prev), ...Object.keys(s)])) {
      const pv = (prev as unknown as Record<string, unknown>)[key]
      const nv = (s as unknown as Record<string, unknown>)[key]
      // null stands for "not set", so it survives saving to JSON (undo needs it).
      if (JSON.stringify(pv) !== JSON.stringify(nv)) [b[key], a[key]] = [pv ?? null, nv ?? null]
    }
    if (Object.keys(a).length) changes.push({ id: s.id, type: 'update', before: b, after: a })
  }
  before.forEach((s, index) => {
    if (!now.has(s.id)) changes.push({ id: s.id, type: 'remove', before: s, index })
  })
  return changes
}

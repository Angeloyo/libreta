// `libreta diagram`: the agent lists nodes, groups and arrows; ELK lays the whole graph out.
// The result is ordinary ops (shapes at computed positions), applied as one changeset.

import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { center, union } from './geometry.ts'
import { defaultAnchor, descendants, placeBeside, placeInFreeSpot, type Side } from './layout.ts'
import { getShape, type Board, type Rect, type Shape, type Size } from './model.ts'
import type { ConnectOp, CreateOp, Op } from './ops.ts'
import { autoSize, contentTop, fontSizeOf, FRAME_PAD, textWidth } from './text.ts'

const elk = new ELK()

export type Direction = 'right' | 'down' | 'left' | 'up'

export interface DiagramOptions {
  direction?: Direction
  /** Wrap the diagram in this frame. Re-running with the same id replaces the old diagram. */
  frame?: { id: string; title?: string; size?: Size }
  /** Put the diagram beside an existing shape. Default: below the agent's last frame. */
  place?: { side: Side; of: string; gap?: number }
  spacing?: 'compact' | 'normal' | 'loose'
  /** Where the human is looking. */
  view?: Rect
}

const SPACING = {
  compact: { node: 30, layer: 60 },
  normal: { node: 50, layer: 90 },
  loose: { node: 80, layer: 130 },
}

const PLACEMENT_KEYS = ['at', 'right_of', 'left_of', 'above', 'below', 'near', 'after', 'before'] as const

export async function layoutDiagram(board: Board, input: Op[], opts: DiagramOptions = {}): Promise<{ ops: Op[]; errors: string[]; notes: string[] }> {
  const errors: string[] = []
  const notes: string[] = []
  const creates: CreateOp[] = []
  const connects: ConnectOp[] = []
  input.forEach((op, i) => {
    if (op.op === 'create' && op.kind !== 'pen') creates.push({ ...op, id: op.id ?? `n${i + 1}` })
    else if (op.op === 'connect') connects.push(op)
    else errors.push(`op ${i + 1}: a diagram only takes shapes, frames and arrows (got ${op.op}${op.op === 'create' ? ' pen' : ''})`)
  })
  for (const c of creates) {
    if (PLACEMENT_KEYS.some((k) => c[k] !== undefined)) notes.push(`ignored the position of ${c.id}: the diagram is laid out automatically`)
  }
  if (errors.length) return { ops: [], errors, notes }

  const ids = new Set(creates.map((c) => c.id!))
  const replacing = opts.frame && getShape(board, opts.frame.id)
  for (const c of creates) {
    const clash = getShape(board, c.id!)
    if (clash && !(replacing && isInside(board, clash, opts.frame!.id))) errors.push(`id "${c.id}" is already on the board — pick another id`)
    if (c.in && !ids.has(c.in) && c.in !== opts.frame?.id) errors.push(`${c.id}: in=${c.in} must name a frame in this diagram`)
  }
  if (errors.length) return { ops: [], errors, notes }

  // Measure every node the way apply() will size it.
  const sizeOf = (c: CreateOp) => {
    if (c.w && c.h) return { w: c.w, h: c.h }
    const probe = { kind: c.kind, text: c.text ?? '', size: c.size ?? 'm', w: 0, h: 0 } as Shape
    return autoSize(probe)
  }

  // Build the ELK graph: frames become compound nodes holding their children.
  const node = (c: CreateOp): ElkNode => {
    if (c.kind !== 'frame') return { id: c.id!, ...toElkSize(sizeOf(c)) }
    const top = contentTop({ kind: 'frame', text: c.text ?? '', size: c.size ?? 'm' } as Shape)
    return {
      id: c.id!,
      layoutOptions: { 'elk.padding': `[top=${top},left=${FRAME_PAD},bottom=${FRAME_PAD},right=${FRAME_PAD}]` },
      children: creates.filter((k) => k.in === c.id).map(node),
    }
  }
  const roots = creates.filter((c) => !c.in || c.in === opts.frame?.id)
  const edges: ElkExtendedEdge[] = connects
    .filter((e) => typeof e.from === 'string' && typeof e.to === 'string' && ids.has(e.from) && ids.has(e.to))
    .map((e, i) => ({
      id: `e${i}`,
      sources: [e.from as string],
      targets: [e.to as string],
      labels: e.text ? [{ text: e.text, width: textWidth(e.text, 16) + 16, height: 26 }] : [],
    }))
  const graph: ElkNode = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': (opts.direction ?? 'right').toUpperCase(),
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(SPACING[opts.spacing ?? 'normal'].node),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(SPACING[opts.spacing ?? 'normal'].layer),
      'elk.spacing.edgeNode': '30',
      'elk.spacing.edgeLabel': '6',
      'elk.edgeLabels.placement': 'CENTER',
    },
    children: roots.map(node),
    edges,
  })

  // Absolute positions, relative to the diagram's top-left corner.
  const pos = new Map<string, Rect>()
  const collect = (n: ElkNode, ox: number, oy: number) => {
    for (const child of n.children ?? []) {
      const r = { x: ox + (child.x ?? 0), y: oy + (child.y ?? 0), w: child.width ?? 0, h: child.height ?? 0 }
      pos.set(child.id, r)
      collect(child, r.x, r.y)
    }
  }
  collect(graph, 0, 0)

  // ELK's own size includes room for its edge routes; ours are drawn differently, so fit the nodes.
  const content = union([...pos.values()]) ?? { x: 0, y: 0, w: 0, h: 0 }
  for (const r of pos.values()) [r.x, r.y] = [r.x - content.x, r.y - content.y]

  // Where the diagram goes: where the old one was, beside the shape asked for, or below the
  // agent's last frame (so step-by-step frames read top to bottom).
  const wrap = opts.frame
  const wrapShape = { kind: 'frame', text: wrap?.title ?? '', size: wrap?.size ?? 'm' } as Shape
  const top = wrap ? contentTop(wrapShape) : 0
  const width = Math.max(content.w + (wrap ? 2 * FRAME_PAD : 0), wrap?.title ? textWidth(wrap.title, fontSizeOf(wrapShape), true) + 60 : 0)
  const height = content.h + (wrap ? top + FRAME_PAD : 0)
  if (opts.place && !getShape(board, opts.place.of)) errors.push(`no shape "${opts.place.of}" to place the diagram ${opts.place.side} of`)
  if (errors.length) return { ops: [], errors, notes }
  const origin = replacing ? { x: replacing.x, y: replacing.y } : findSpot(board, width, height, opts)
  const inset = wrap ? { x: FRAME_PAD, y: top } : { x: 0, y: 0 }

  const ops: Op[] = []
  const old = replacing ? descendants(board, replacing.id) : []
  const reused = new Set(old.filter((s) => creates.some((c) => c.id === s.id)).map((s) => s.id))
  if (replacing) {
    // Revise in place. Shapes that come back keep their ids (so arrows the human drew to them
    // survive); the rest of the old diagram goes, except anything the human made.
    for (const s of old) if (s.kind !== 'arrow' && (reused.has(s.id) || s.by === 'human')) ops.push({ op: 'move', id: s.id, in: replacing.id })
    const inside = new Set([replacing.id, ...old.map((s) => s.id)])
    for (const a of board.shapes) {
      const ends = [a.from, a.to].map((e) => (e && 'id' in e ? e.id : ''))
      if (a.kind === 'arrow' && a.by === 'agent' && ends.every((id) => inside.has(id))) ops.push({ op: 'delete', id: a.id })
    }
    for (const s of old) if (s.kind !== 'arrow' && !reused.has(s.id) && s.by !== 'human') ops.push({ op: 'delete', id: s.id })
    ops.push(stripUndefined({ op: 'update', id: replacing.id, text: wrap?.title, size: wrap?.size, w: width, h: height }))
  } else if (wrap) {
    ops.push(stripUndefined({ op: 'create', kind: 'frame', id: wrap.id, text: wrap.title, size: wrap.size, at: [origin.x, origin.y], w: width, h: height, layout: 'none' }))
  }
  for (const c of orderParentsFirst(creates)) {
    const r = pos.get(c.id!)!
    const at: [number, number] = [Math.round(origin.x + inset.x + r.x), Math.round(origin.y + inset.y + r.y)]
    const size = c.kind === 'frame' ? { w: Math.round(r.w), h: Math.round(r.h) } : c.w && c.h ? { w: c.w, h: c.h } : {}
    const parent = c.in && c.in !== wrap?.id ? c.in : wrap?.id
    const style = { text: c.text, color: c.color, fill: c.fill, stroke: c.stroke, size: c.size }
    if (reused.has(c.id!)) {
      ops.push(stripUndefined({ op: 'update', id: c.id!, ...style, ...size }))
      ops.push(stripUndefined({ op: 'move', id: c.id!, in: parent ?? null, at }))
    } else {
      ops.push(stripUndefined({ op: 'create', kind: c.kind, id: c.id, ...style, ...size, at, in: parent, layout: c.kind === 'frame' ? 'none' : undefined }))
    }
  }
  ops.push(...connects)
  if (replacing) notes.push(`revised diagram ${replacing.id}: kept ${reused.size} shapes by id, removed ${old.filter((s) => s.kind !== 'arrow' && !reused.has(s.id) && s.by !== 'human').length}`)
  return { ops, errors, notes }
}

function toElkSize(s: { w: number; h: number }) {
  return { width: s.w, height: s.h }
}

function isInside(board: Board, shape: Shape, frameId: string): boolean {
  for (let p = shape.parent; p; p = getShape(board, p)?.parent) if (p === frameId) return true
  return shape.id === frameId
}

function orderParentsFirst(creates: CreateOp[]): CreateOp[] {
  const out: CreateOp[] = []
  const visit = (parent: string | undefined) => {
    for (const c of creates.filter((k) => (k.in ?? undefined) === parent)) {
      out.push(c)
      if (c.kind === 'frame') visit(c.id)
    }
  }
  visit(undefined)
  for (const c of creates) if (!out.includes(c)) out.push(c) // children of the wrapping frame
  return out
}

function findSpot(board: Board, w: number, h: number, opts: DiagramOptions): { x: number; y: number } {
  const probe: Shape = { id: '__diagram', kind: 'frame', x: 0, y: 0, w, h, text: '', color: 'grey', fill: 'none', stroke: 'solid', size: 'm', by: 'agent' }
  const scratch: Board = { ...board, shapes: [...board.shapes, probe] }
  const lastFrame = board.shapes.findLast((s) => s.kind === 'frame' && !s.parent && s.by === 'agent')
  if (opts.place) placeBeside(scratch, probe, getShape(board, opts.place.of)!, opts.place.side, opts.place.gap ?? 80, 'start')
  else if (lastFrame) placeBeside(scratch, probe, lastFrame, 'below', 80, 'start')
  else placeInFreeSpot(scratch, probe, opts.view ? center(opts.view) : defaultAnchor(scratch, probe))
  return { x: probe.x, y: probe.y }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

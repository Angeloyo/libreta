// What the agent reads: a compact text view of the board, plus plain-language summaries
// of what changed. Defaults (black, no fill, solid, size m) are left out to keep it short.

import { round10, type Point } from './geometry.ts'
import { childrenOf, getShape, type Board, type Change, type Changeset, type End, type Rect, type Shape } from './model.ts'
import { penMeaning } from './ink.ts'
import type { Problem } from './lint.ts'

export type Detail = 'outline' | 'normal' | 'full'

export interface Presence {
  view?: Rect
  selection?: string[]
  cursor?: Point
}

const q = (text: string) => JSON.stringify(text)
const box = (r: Rect) => `(${round10(r.x)},${round10(r.y)} ${round10(r.w)}x${round10(r.h)})`

function endName(end: End | undefined): string {
  if (!end) return '?'
  return 'id' in end ? end.id : `(${round10(end.x)},${round10(end.y)})`
}

export function arrowLink(s: Shape): string {
  const link = s.heads === 'both' ? '<->' : s.heads === 'none' ? '--' : '->'
  return `${endName(s.from)} ${link} ${endName(s.to)}`
}

const DEFAULT_COLOR: Record<string, string> = { sticky: 'yellow', frame: 'grey' }

/**
 * One line describing a shape, e.g. `box api "API Gateway" (560,140 240x80) blue`.
 * With the board, pen strokes say what they mark ("circles web").
 */
export function describe(s: Shape, opts: { detail?: Detail; withParent?: boolean; board?: Board } = {}): string {
  const detail = opts.detail ?? 'normal'
  const parts: string[] =
    s.kind === 'arrow' ? [s.id, arrowLink(s)] : [s.kind, s.id]
  if (s.text) parts.push(q(s.text))
  if (s.kind !== 'arrow' && detail !== 'outline') parts.push(box(s))
  if (s.color !== (DEFAULT_COLOR[s.kind] ?? 'black')) parts.push(s.color)
  if (s.fill !== 'none') parts.push(`fill=${s.fill}`)
  if (s.stroke !== 'solid') parts.push(s.stroke)
  if (s.size !== 'm') parts.push(`size=${s.size}`)
  if (s.kind === 'frame' && s.layout && s.layout !== 'none') {
    parts.push(`layout=${s.layout}`)
    if (s.spacing !== undefined) parts.push(`spacing=${s.spacing}`)
    if (s.cols !== undefined) parts.push(`cols=${s.cols}`)
  }
  if (s.kind === 'pen') {
    const meaning = opts.board && penMeaning(opts.board, s)
    if (meaning) parts.push(meaning)
    if (detail === 'full') parts.push(`${s.points?.length ?? 0} points`)
  }
  if (opts.withParent && s.parent) parts.push(`in ${s.parent}`)
  if (s.by === 'human') parts.push('by=human')
  if (s.pinned) parts.push('pinned')
  return parts.join(' ')
}

export interface ReadOptions {
  /** How to name the board (its path in the library). Default: its name. */
  title?: string
  detail?: Detail
  /** Only these shapes (and arrows between them). Default: everything. */
  only?: Set<string>
  presence?: Presence
  problems?: Problem[]
  /** Changes the human made that the agent hasn't seen yet. */
  humanSince?: { rev: number; lines: string[] }
}

export function readView(board: Board, opts: ReadOptions = {}): string {
  const detail = opts.detail ?? 'normal'
  const visible = (s: Shape) => !opts.only || opts.only.has(s.id)
  const shapes = board.shapes.filter((s) => s.kind !== 'arrow')
  const arrows = board.shapes.filter((s) => s.kind === 'arrow' && visible(s))
  const lines: string[] = []

  const shown = shapes.filter(visible).length
  const count = `${shown} shape${shown === 1 ? '' : 's'}, ${arrows.length} arrow${arrows.length === 1 ? '' : 's'}${opts.only ? ' in scope' : ''}`
  lines.push(`board ${q(opts.title ?? board.name)} rev=${board.rev} · ${board.shapes.length ? count : 'empty'}`)
  lines.push(opts.presence ? presenceLine(opts.presence) : 'human: no browser is showing this board')

  const walk = (parent: string | undefined, indent: string) => {
    for (const s of shapes.filter((s) => s.parent === parent)) {
      const hasVisibleChild = s.kind === 'frame' && childrenOf(board, s.id).some((c) => visible(c))
      if (!visible(s) && !hasVisibleChild) {
        if (s.kind === 'frame') walk(s.id, indent + '  ') // a frame further down may be in scope
        continue
      }
      lines.push(indent + describe(s, { detail, board }))
      if (s.layout === 'table' && detail !== 'full') lines.push(...tableLines(board, s, indent + '  '))
      else if (s.kind === 'frame') walk(s.id, indent + '  ')
    }
  }
  walk(undefined, '')
  for (const a of arrows) lines.push(describe(a, { detail }))

  if (opts.problems) lines.push(...problemLines(opts.problems))
  if (opts.humanSince) lines.push(...humanLines(opts.humanSince.rev, opts.humanSince.lines))
  return lines.join('\n')
}

/** A table's cells as markdown rows, plus how to address them. */
function tableLines(board: Board, table: Shape, indent: string): string[] {
  const cells = childrenOf(board, table.id).filter((c) => c.kind !== 'arrow')
  const cols = table.cols ?? 1
  const rows: Shape[][] = []
  for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols))
  const cell = (c: Shape) => c.text.replace(/\n/g, '\\n').replace(/\|/g, '/')
  const lines = rows.map((r) => `${indent}| ${r.map(cell).join(' | ')} |`)
  const patterned = cells.every((c, i) => c.id === `${table.id}-r${Math.floor(i / cols) + 1}c${(i % cols) + 1}`)
  lines.push(patterned ? `${indent}cells: ${table.id}-r<row>c<col>` : `${indent}cells by row: ${rows.map((r) => r.map((c) => c.id).join(' ')).join(' / ')}`)
  return lines
}

function presenceLine(p: Presence): string {
  const parts = ['human:']
  if (p.view) parts.push(`viewing ${box(p.view)}`)
  parts.push(p.selection?.length ? `· selected [${p.selection.join(', ')}] ("this" = selection)` : '· nothing selected')
  return parts.join(' ')
}

export function problemLines(problems: Problem[]): string[] {
  if (!problems.length) return ['problems: none']
  const shown = problems.slice(0, 12).map((p) => `- ${p.message}`)
  if (problems.length > 12) shown.push(`- ...and ${problems.length - 12} more (libreta read shows all)`)
  return ['problems:', ...shown]
}

export function humanLines(rev: number, lines: string[]): string[] {
  if (!lines.length) return [`human since rev ${rev}: no changes`]
  return [`human since rev ${rev}:`, ...lines.map((l) => `- ${l}`)]
}

// ---- Change summaries ----

/** Merges a run of changesets into one change per shape: first before, last after. */
function merge(changesets: Changeset[]): Change[] {
  const byId = new Map<string, Change>()
  for (const cs of changesets) {
    for (const c of cs.changes) {
      const prev = byId.get(c.id)
      if (!prev) {
        byId.set(c.id, structuredClone(c))
        continue
      }
      if (prev.type === 'add' && c.type === 'remove') byId.delete(c.id)
      else if (prev.type === 'add') prev.after = { ...prev.after, ...c.after }
      else if (prev.type === 'remove' && c.type === 'add') {
        // Removed, then put back (an undo): no change, or just the fields that differ.
        const [before, after] = [prev.before as Record<string, unknown>, c.after as Record<string, unknown>]
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
        if (!keys.length) byId.delete(c.id)
        else byId.set(c.id, { id: c.id, type: 'update', before: Object.fromEntries(keys.map((k) => [k, before[k] ?? null])), after: Object.fromEntries(keys.map((k) => [k, after[k] ?? null])) })
      }
      else if (c.type === 'remove') byId.set(c.id, { id: c.id, type: 'remove', before: { ...c.before, ...prev.before } })
      else {
        prev.before = { ...c.before, ...prev.before }
        prev.after = { ...prev.after, ...c.after }
      }
    }
  }
  return [...byId.values()]
}

const pos = (x: unknown, y: unknown) => `(${round10(Number(x))},${round10(Number(y))})`

function describeUpdate(c: Change, board: Board): string | undefined {
  const b = c.before as Record<string, unknown>
  const a = c.after as Record<string, unknown>
  const now = getShape(board, c.id)
  const parts: string[] = []
  const changed = (k: string) => k in a && JSON.stringify(a[k]) !== JSON.stringify(b[k])
  if (changed('text')) {
    const [before, after] = [String(b.text ?? ''), String(a.text ?? '')]
    // For long texts, only what was added reads better than the whole before → after.
    if (before.length >= 30 && after.startsWith(before)) parts.push(`text: appended ${q(after.slice(before.length))}`)
    else parts.push(`text ${q(before)} → ${q(after)}`)
  }
  if (changed('parent')) parts.push(a.parent ? `moved into ${a.parent}` : `moved out of ${b.parent}`)
  else if (changed('x') || changed('y')) {
    const [bx, by] = [b.x ?? now?.x, b.y ?? now?.y]
    const [ax, ay] = [a.x ?? now?.x, a.y ?? now?.y]
    if (pos(bx, by) !== pos(ax, ay)) parts.push(`moved ${pos(bx, by)} → ${pos(ax, ay)}`)
  }
  if ((changed('w') || changed('h')) && now?.kind !== 'pen') {
    const size = (w: unknown, h: unknown) => `${round10(Number(w))}x${round10(Number(h))}`
    const from = size(b.w ?? now?.w, b.h ?? now?.h)
    const to = size(a.w ?? now?.w, a.h ?? now?.h)
    if (from !== to) parts.push(`resized ${from} → ${to}`)
  }
  for (const k of ['color', 'fill', 'stroke', 'size', 'layout', 'spacing', 'cols', 'heads']) {
    if (changed(k)) parts.push(`${k} ${b[k] ?? 'default'} → ${a[k] ?? 'default'}`)
  }
  if ((changed('from') || changed('to')) && now) parts.push(`now ${arrowLink(now)}`)
  if (changed('points')) parts.push('redrawn')
  return parts.length ? `${c.id} ${parts.join(' · ')}` : undefined
}

const GEOMETRY = new Set(['x', 'y', 'w', 'h'])

/** Plain-language lines for what a run of changesets did, e.g. `api text "API" → "Gateway"`. */
export function summarize(board: Board, changesets: Changeset[], limit = 12): string[] {
  const lines: string[] = []
  // Shapes that only moved because their layout frame rearranged them get one line per frame.
  const rearranged = new Map<string, string[]>()
  const isLayout = (id?: string) => {
    const f = id ? getShape(board, id) : undefined
    return !!f && f.kind === 'frame' && !!f.layout && f.layout !== 'none'
  }
  const changes = merge(changesets)
  // A new table is one line, not one per cell.
  const newTables = new Set(changes.filter((c) => c.type === 'add' && (c.after as Shape).layout === 'table').map((c) => c.id))
  for (const c of changes) {
    if (c.type === 'add') {
      const s = getShape(board, c.id) ?? (c.after as Shape)
      if (s.parent && newTables.has(s.parent)) continue
      const near = s.by === 'human' && s.kind !== 'pen' && s.kind !== 'arrow' && !isLayout(s.parent) ? whereIs(board, s) : undefined
      const table = s.layout === 'table' ? ` · ${Math.ceil(childrenOf(board, s.id).length / (s.cols ?? 1))} rows × ${s.cols ?? 1} cols` : ''
      lines.push(`+ ${describe(s, { withParent: true, board })}${table}${near ? ` · ${near}` : ''}`)
    }
    else if (c.type === 'remove') {
      const s = c.before as Shape
      lines.push(`- ${s.kind === 'arrow' ? `arrow ${s.id} ${arrowLink(s)}` : `${s.kind} ${s.id}${s.text ? ' ' + q(s.text) : ''}`}`)
    } else {
      const s = getShape(board, c.id)
      const keys = Object.keys(c.after ?? {})
      const onlyGeometry = keys.every((k) => GEOMETRY.has(k) || k === 'auto')
      const frameMoved = s && isLayout(s.id) && (keys.includes('x') || keys.includes('y'))
      if (onlyGeometry && s && !frameMoved && (isLayout(s.parent) || isLayout(s.id))) {
        const frame = isLayout(s.parent) ? s.parent! : s.id
        rearranged.set(frame, [...(rearranged.get(frame) ?? []), ...(frame === s.id ? [] : [s.id])])
        continue
      }
      const line = describeUpdate(c, board)
      if (line) lines.push(line)
    }
  }
  for (const [frame, ids] of rearranged) {
    const cells = getShape(board, frame)?.layout === 'table'
    lines.push(!ids.length ? `${frame} resized to fit` : cells ? `${frame} rearranged its cells` : `${frame} rearranged its children (${ids.join(', ')} shifted)`)
  }
  if (lines.length > limit) return [...lines.slice(0, limit), `...and ${lines.length - limit} more`]
  return lines
}

/**
 * Where a new shape sits relative to its closest neighbour (within 200px), e.g.
 * "right of q3, outside frame qs": that's how a sticky says which question it answers.
 */
function whereIs(board: Board, s: Shape): string | undefined {
  const gapX = (o: Shape) => Math.max(0, o.x - (s.x + s.w), s.x - (o.x + o.w))
  const gapY = (o: Shape) => Math.max(0, o.y - (s.y + s.h), s.y - (o.y + o.h))
  const others = board.shapes.filter((o) => o !== s && o.kind !== 'arrow' && o.kind !== 'pen' && o.kind !== 'frame' && o.parent !== s.id)
  const best = others.map((o) => ({ o, d: Math.hypot(gapX(o), gapY(o)) })).sort((a, b) => a.d - b.d)[0]
  if (!best || best.d > 200) return undefined
  const o = best.o
  const side =
    gapX(o) >= gapY(o) ? (s.x >= o.x + o.w ? 'right of' : s.x + s.w <= o.x ? 'left of' : 'on') : s.y >= o.y + o.h ? 'below' : 'above'
  const outside = o.parent && o.parent !== s.parent ? `, outside frame ${o.parent}` : ''
  return `${side === 'on' ? 'on top of' : side} ${o.id}${outside}`
}

/** Human changesets after `rev`, summarized. */
export function humanChangesSince(board: Board, rev: number): string[] {
  return summarize(board, board.log.filter((cs) => cs.rev > rev && cs.by === 'human'))
}

// The change log as history: who did what, the board as it was at any rev, undo and restore.
// Every changeset stores the exact before/after of each field, so the past can be rebuilt by
// walking the log backwards.

import { diff } from './apply.ts'
import { penMeaning } from './ink.ts'
import { settle } from './layout.ts'
import { getShape, LOG_LIMIT, type Author, type Board, type Changeset, type Shape } from './model.ts'

/** Shapes with one changeset taken back (exactly: no layout runs). */
export function undoChanges(shapes: Shape[], cs: Changeset): Shape[] {
  const added = new Set(cs.changes.filter((c) => c.type === 'add').map((c) => c.id))
  const next = structuredClone(shapes).filter((s) => !added.has(s.id))
  for (const c of cs.changes) {
    if (c.type !== 'update') continue
    const s = next.find((x) => x.id === c.id) as unknown as Record<string, unknown> | undefined
    if (!s) continue
    for (const [key, value] of Object.entries(c.before ?? {})) {
      if (value === null || value === undefined) delete s[key]
      else s[key] = structuredClone(value)
    }
  }
  // Removed shapes go back where they were in the list, lowest position first.
  const removed = cs.changes.filter((c) => c.type === 'remove' && !next.some((s) => s.id === c.id))
  for (const c of removed.sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))) {
    next.splice(Math.min(c.index ?? next.length, next.length), 0, structuredClone(c.before as Shape))
  }
  return next
}

/** The oldest rev the log can still rebuild. */
export const oldestRev = (board: Board) => (board.log.length ? board.log[0].rev - 1 : board.rev)

/** The board's shapes as they were right after `rev`, or undefined if that's older than the log. */
export function shapesAt(board: Board, rev: number): Shape[] | undefined {
  if (rev < oldestRev(board) || rev > board.rev) return undefined
  let shapes = board.shapes
  for (const cs of [...board.log].reverse()) {
    if (cs.rev <= rev) break
    shapes = undoChanges(shapes, cs)
  }
  return shapes
}

export interface HistoryResult {
  board: Board
  changeset?: Changeset
  notes: string[]
}

/** Records `shapes` as the board's new state, as one changeset. */
function commit(board: Board, shapes: Shape[], by: Author, label: string, now: number, notes: string[], agent?: string): HistoryResult {
  const changes = diff(board.shapes, shapes)
  if (!changes.length) return { board, notes: [...notes, 'nothing changed'] }
  const changeset: Changeset = { rev: board.rev + 1, by, agent, label, at: now, changes }
  return { board: { ...board, shapes, rev: changeset.rev, log: [...board.log, changeset].slice(-LOG_LIMIT) }, changeset, notes }
}

/** Undo: a new changeset that puts back what `target` changed. Undoing an undo is redo. */
export function revert(board: Board, target: Changeset, by: Author, agent?: string, now = Date.now()): HistoryResult {
  const next: Board = { ...board, shapes: undoChanges(board.shapes, target) }
  const notes: string[] = []
  // Arrows whose shapes are gone again go too.
  const ids = new Set(next.shapes.map((s) => s.id))
  const dangling = next.shapes.filter((s) => s.kind === 'arrow' && [s.from, s.to].some((e) => e && 'id' in e && !ids.has(e.id)))
  if (dangling.length) {
    notes.push(`also removed ${dangling.map((s) => s.id).join(', ')} (their shapes are gone)`)
    next.shapes = next.shapes.filter((s) => !dangling.includes(s))
  }
  settle(next)
  const result = commit(board, next.shapes, by, `undo rev ${target.rev}`, now, notes, agent)
  return result.changeset ? result : { board, notes: [...notes, 'nothing to undo — it was already changed back'] }
}

/** Makes the board look exactly as it did right after `rev`, as one new (undoable) changeset. */
export function restore(board: Board, rev: number, by: Author, agent?: string, now = Date.now()): HistoryResult {
  const past = shapesAt(board, rev)
  if (!past) return { board, notes: [`rev ${rev} is older than the history kept for this board (it starts at rev ${oldestRev(board)})`] }
  return commit(board, past, by, `restore rev ${rev}`, now, [], agent)
}

/** A one-line, human-friendly description of a changeset, for the history list. */
export function changesetTitle(board: Board, cs: Changeset): string {
  const label = cs.label ?? ''
  const name = (id: string, fallback?: Partial<Shape>): string => {
    const s = getShape(board, id) ?? (fallback as Shape | undefined)
    if (s?.kind === 'arrow' && s.from && s.to) return `${endName(s.from)} → ${endName(s.to)}`
    if (s?.kind === 'pen') return penMeaning(board, s) ?? 'a drawing'
    const text = (s?.text ?? '').split('\n')[0]
    return text ? `“${text.length > 24 ? text.slice(0, 23) + '…' : text}”` : id
  }
  const endName = (end: NonNullable<Shape['from']>): string => ('id' in end ? name(end.id) : 'a point')
  if (cs.by === 'agent' && label === 'diagram') {
    const frame = cs.changes.map((c) => getShape(board, c.id)).find((s) => s?.kind === 'frame' && !s.parent)
    return frame?.text ? `Drew a diagram: ${name(frame.id)}` : 'Drew a diagram'
  }
  if (cs.by === 'agent' && label && !/^(undo|restore) rev/.test(label)) return label
  const names = cs.changes.map((c) => name(c.id, (c.after ?? c.before) as Partial<Shape>))
  const what = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
  const verbs: Record<string, string> = {
    create: 'Added', text: 'Edited', move: 'Moved', nudge: 'Moved', style: 'Restyled', delete: 'Deleted',
    draw: 'Drew:', resize: 'Resized', arrow: 'Connected', diagram: 'Drew a diagram:',
  }
  if (/^undo rev/.test(label)) return `Undid rev ${label.split(' ').pop()}`
  if (/^restore rev/.test(label)) return `Restored the board to rev ${label.split(' ').pop()}`
  return `${verbs[label] ?? 'Changed'} ${what}`.trim()
}

/** One row of the history list. */
export interface HistoryEntry {
  rev: number
  by: Author
  agent?: string
  title: string
  at: number
  counts: { added: number; edited: number; removed: number }
  /** The shapes it touched (the ones still on the board can be highlighted). */
  ids: string[]
}

export function historyEntry(board: Board, cs: Changeset): HistoryEntry {
  return { rev: cs.rev, by: cs.by, agent: cs.agent, title: changesetTitle(board, cs), at: cs.at, counts: changesetCounts(cs), ids: cs.changes.map((c) => c.id) }
}

/** Counts for a changeset: how many shapes it added, edited and removed. */
export function changesetCounts(cs: Changeset): { added: number; edited: number; removed: number } {
  const count = (type: string) => cs.changes.filter((c) => c.type === type).length
  return { added: count('add'), edited: count('update'), removed: count('remove') }
}

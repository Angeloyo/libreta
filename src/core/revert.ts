// Undo is a new changeset that puts back what an earlier one changed. Undoing an undo is redo.

import { diff } from './apply.ts'
import { settle } from './layout.ts'
import { getShape, LOG_LIMIT, type Author, type Board, type Changeset, type Shape } from './model.ts'

export interface RevertResult {
  board: Board
  changeset?: Changeset
  notes: string[]
}

export function revert(board: Board, target: Changeset, by: Author, now = Date.now()): RevertResult {
  const next: Board = { ...board, shapes: structuredClone(board.shapes) }
  const notes: string[] = []
  for (const c of [...target.changes].reverse()) {
    if (c.type === 'add') next.shapes = next.shapes.filter((s) => s.id !== c.id)
    else if (c.type === 'remove') {
      if (!getShape(next, c.id)) next.shapes.push(structuredClone(c.before as Shape))
    } else {
      const s = getShape(next, c.id) as unknown as Record<string, unknown> | undefined
      if (!s) continue
      for (const [key, value] of Object.entries(c.before ?? {})) {
        if (value === null || value === undefined) delete s[key]
        else s[key] = structuredClone(value)
      }
    }
  }
  // Arrows whose shapes are gone again go too.
  const ids = new Set(next.shapes.map((s) => s.id))
  const dangling = next.shapes.filter((s) => s.kind === 'arrow' && [s.from, s.to].some((e) => e && 'id' in e && !ids.has(e.id)))
  if (dangling.length) {
    notes.push(`also removed ${dangling.map((s) => s.id).join(', ')} (their shapes are gone)`)
    next.shapes = next.shapes.filter((s) => !dangling.includes(s))
  }
  settle(next)
  const changes = diff(board.shapes, next.shapes)
  if (!changes.length) return { board, notes: [...notes, 'nothing to undo — it was already changed back'] }
  const changeset: Changeset = { rev: board.rev + 1, by, label: `undo rev ${target.rev}`, at: now, changes }
  next.rev = changeset.rev
  next.log = [...board.log, changeset].slice(-LOG_LIMIT)
  return { board: next, changeset, notes }
}

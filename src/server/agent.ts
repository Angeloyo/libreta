// What the CLI talks to. Every answer is compact text written for an agent to read,
// and ends with what the human changed since that agent last looked.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply, type ApplyResult } from '../core/apply.ts'
import { layoutDiagram, type DiagramOptions, type Direction } from '../core/diagram.ts'
import { parseDsl } from '../core/dsl.ts'
import { inflate, intersects, union } from '../core/geometry.ts'
import { descendants } from '../core/layout.ts'
import { lint, lintAround } from '../core/lint.ts'
import { getShape, type Board, type Shape, type Size } from '../core/model.ts'
import { parseOps, type Op } from '../core/ops.ts'
import { historyEntry, oldestRev } from '../core/history.ts'
import { humanChangesSince, humanLines, problemLines, readView, summarize, type Detail } from '../core/view.ts'
import { activeBoard, allRooms, applyToRoom, getRoom, markSeen, revertInRoom, seenBy, type Room } from './rooms.ts'
import { UserError } from './errors.ts'
import { findBoard } from './library.ts'
import { renderPng, writePng } from './png.ts'

/**
 * The board a command is about: the one named, else the one open in the browser. If several
 * boards are open in different tabs, guessing could draw on the wrong one, so it asks instead.
 */
export function roomFor(ref: string | null): Room {
  if (ref) return getRoom(findBoard(ref))
  const open = allRooms().filter((r) => r.clients.size > 0)
  if (open.length > 1) throw new UserError(`${open.length} boards are open in the browser (${open.map((r) => `"${r.path}"`).join(', ')}) — name the one you mean, e.g. libreta read "${open[0].path}"`)
  if (open.length === 1) return open[0]
  const active = activeBoard()
  if (!active) throw new UserError('no board is open in the browser — name one (see: libreta ls), or show one: libreta open <board>')
  return getRoom(active)
}

/** The human's selection, and whether it changed since this agent last heard about it. */
function selectionLine(room: Room, agent: string): string {
  const now = room.presence?.selection ?? []
  const show = (ids: string[]) => (ids.length ? `[${ids.join(', ')}]` : 'nothing')
  const before = room.seenSelection.get(agent) ?? []
  room.seenSelection.set(agent, now)
  if (show(before) !== show(now)) return `selection changed: ${show(before)} → ${show(now)}`
  return now.length ? `still selected: ${show(now)}` : 'nothing selected'
}

/** What the human changed since `agent` last looked, then mark everything as seen. */
function catchUp(room: Room, agent: string): string[] {
  const seen = seenBy(room, agent)
  markSeen(room, agent)
  if (seen === undefined) return []
  return humanLines(seen, humanChangesSince(room.board, seen))
}

const endIds = (s: Shape) => [s.from, s.to].flatMap((e) => (e && 'id' in e ? [e.id] : []))

/** Which shapes a scope covers: all, selection, view, frame:<id>, or a list of ids. */
function scopeIds(room: Room, scope: string | null): Set<string> | undefined {
  const { board, presence } = room
  if (!scope || scope === 'all') return undefined
  let ids: string[]
  if (scope === 'selection') {
    if (!presence?.selection?.length) throw new UserError('nothing is selected in the browser')
    ids = presence.selection
  } else if (scope === 'view') {
    if (!presence?.view) throw new UserError("no browser is showing this board, so there's no view")
    ids = board.shapes.filter((s) => s.kind !== 'arrow' && intersects(s, presence.view!)).map((s) => s.id)
  } else {
    const list = scope.replace(/^(frame|ids):/, '').split(',').map((s) => s.trim())
    for (const id of list) if (!getShape(board, id)) throw new UserError(`no shape "${id}" on this board`)
    ids = list.flatMap((id) => [id, ...descendants(board, id).map((s) => s.id)])
  }
  const set = new Set(ids)
  // Arrows come along when they touch the scope.
  for (const s of board.shapes) if (s.kind === 'arrow' && endIds(s).some((id) => set.has(id))) set.add(s.id)
  return set
}

export function read(room: Room, q: URLSearchParams): string {
  const agent = q.get('agent') ?? 'claude'
  const only = scopeIds(room, q.get('scope'))
  const problems = lint(room.board).filter((p) => !only || p.ids.some((id) => only.has(id)))
  const seen = seenBy(room, agent)
  const text = readView(room.board, {
    title: room.path,
    detail: (q.get('detail') as Detail) ?? 'normal',
    only,
    presence: room.clients.size ? (room.presence ?? {}) : undefined,
    problems,
    humanSince: seen === undefined ? undefined : { rev: seen, lines: humanChangesSince(room.board, seen) },
  })
  markSeen(room, agent)
  room.seenSelection.set(agent, room.presence?.selection ?? [])
  return text
}

/**
 * What the human changed since this agent last looked (and their selection), without the whole
 * board. Cheap enough to run at the start of every turn.
 */
export function changes(room: Room, q: URLSearchParams): string {
  const agent = q.get('agent') ?? 'claude'
  const seen = seenBy(room, agent)
  if (seen === undefined) return `you haven't looked at "${room.path}" yet — start with: libreta read "${room.path}"`
  const lines = humanChangesSince(room.board, seen)
  markSeen(room, agent)
  const head = lines.length ? `the human changed "${room.path}" since you last looked (rev ${seen} → ${room.board.rev}):` : `no changes on "${room.path}" since you last looked (rev ${room.board.rev})`
  return [head, ...lines.map((l) => `- ${l}`), selectionLine(room, agent)].join('\n')
}

interface Parsed {
  ops: Op[]
  errors: string[]
  label?: string
  /** How to name op i in errors: its line in the line format, or its index in JSON. */
  where?: (i: number) => string
}

/** Ops from the request body: the line format, or JSON ({ops: [...]} or a bare array). */
function parseBody(body: string): Parsed {
  const trimmed = body.trim()
  if (!trimmed) return { ops: [], errors: ["no ops — pipe them in, e.g. libreta apply <<'EOF' ... EOF"] }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const { ops, errors, lines } = parseDsl(body)
    return { ops, errors, where: (i) => `line ${lines[i]}` }
  }
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch (e) {
    return { ops: [], errors: [`invalid JSON: ${(e as Error).message}`] }
  }
  const raw = Array.isArray(json) ? json : (json as { ops?: unknown[] }).ops
  if (!Array.isArray(raw)) return { ops: [], errors: ['JSON must be {"ops": [...]} or an array of ops'] }
  return { ...parseOps(raw), label: Array.isArray(json) ? undefined : (json as { label?: string }).label }
}

function failed(errors: string[]): UserError {
  return new UserError(['nothing was applied:', ...errors.map((e) => `- ${e}`)].join('\n'))
}

function applyText(room: Room, agent: string, result: ApplyResult, dry: boolean): string {
  if (!result.ok) throw failed(result.errors)
  const lines: string[] = []
  const cs = result.changeset
  if (!cs) lines.push(dry ? 'dry run · nothing would change' : 'ok · nothing changed')
  else {
    lines.push(dry ? `dry run on "${room.path}" · would make rev ${cs.rev} (nothing saved)` : `ok rev=${cs.rev} on "${room.path}"${cs.label ? ` · ${JSON.stringify(cs.label)}` : ''}`)
    lines.push(...summarize(result.board, [cs], 60))
  }
  const notes = result.notes.filter((n) => n !== 'nothing changed')
  if (notes.length) lines.push('notes:', ...notes.map((n) => `- ${n}`))
  const changed = new Set(cs?.changes.map((c) => c.id) ?? [])
  lines.push(...problemLines(changed.size ? lintAround(result.board, changed) : []))
  if (dry) return lines.join('\n')
  // If the human changed the board since this agent last looked, say so first: it matters more.
  const caught = catchUp(room, agent)
  const news = caught.length > 1 ? ['⚠ before your change, the human had edited the board:', ...caught.slice(1), ''] : []
  return [...news, ...lines, ...(news.length ? [] : caught)].join('\n')
}

export function applyOps(room: Room, q: URLSearchParams, body: string): string {
  const agent = q.get('agent') ?? 'claude'
  const parsed = parseBody(body)
  if (parsed.errors.length) throw failed(parsed.errors)
  const dry = q.get('dry') === '1'
  const ctx = {
    by: 'agent' as const,
    agent,
    label: q.get('label') ?? parsed.label,
    baseRev: seenBy(room, agent),
    view: room.presence?.view,
    where: parsed.where,
  }
  const result = dry ? apply(room.board, parsed.ops, ctx) : applyToRoom(room, parsed.ops, ctx)
  return applyText(room, agent, result, dry)
}

export async function diagram(room: Room, q: URLSearchParams, body: string): Promise<string> {
  const agent = q.get('agent') ?? 'claude'
  const parsed = parseBody(body)
  if (parsed.errors.length) throw failed(parsed.errors)
  const frameId = q.get('frame')
  const side = (['below', 'right', 'left', 'above'] as const).find((k) => q.get(k))
  const laid = await layoutDiagram(room.board, parsed.ops, {
    direction: (q.get('direction') as Direction) ?? 'right',
    frame: frameId ? { id: frameId, title: q.get('title') ?? undefined, size: (q.get('size') as Size) ?? undefined } : undefined,
    place: side ? { side, of: q.get(side)!, gap: q.get('gap') ? Number(q.get('gap')) : undefined } : undefined,
    spacing: (q.get('spacing') as DiagramOptions['spacing']) ?? undefined,
    view: room.presence?.view,
  })
  if (laid.errors.length) throw failed(laid.errors)
  const dry = q.get('dry') === '1'
  const ctx = { by: 'agent' as const, agent, label: q.get('label') ?? 'diagram', baseRev: seenBy(room, agent), view: room.presence?.view }
  const result = dry ? apply(room.board, laid.ops, ctx) : applyToRoom(room, laid.ops, ctx)
  result.notes.unshift(...laid.notes)
  return applyText(room, agent, result, dry)
}

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000)
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`
}

/** Who did what, newest first. */
export function history(room: Room, q: URLSearchParams): string {
  const { board } = room
  const limit = Number(q.get('limit') ?? 20)
  const rows = board.log.slice(-limit).reverse().map((cs) => {
    const e = historyEntry(board, cs)
    const who = e.by === 'human' ? 'human' : (e.agent ?? 'agent')
    const counts = [e.counts.added && `+${e.counts.added}`, e.counts.edited && `~${e.counts.edited}`, e.counts.removed && `-${e.counts.removed}`].filter(Boolean).join(' ')
    return `rev ${e.rev} · ${who} · ${e.title} · ${ago(e.at)}${counts ? ` · ${counts}` : ''}`
  })
  return [`history of "${room.path}" (now rev ${board.rev}; kept back to rev ${oldestRev(board)}):`, ...rows].join('\n')
}

/** Reverts a changeset: by default the agent's own latest one. */
export function undo(room: Room, q: URLSearchParams): string {
  const agent = q.get('agent') ?? 'claude'
  const rev = q.get('rev') ? Number(q.get('rev')) : room.board.log.findLast((cs) => cs.by === 'agent' && !cs.label?.startsWith('undo'))?.rev
  if (rev === undefined) throw new UserError('nothing of yours to undo in the recent history')
  const result = revertInRoom(room, rev, 'agent', agent)
  const lines = result.changeset ? [`ok rev=${result.changeset.rev} · undid rev ${rev}`, ...summarize(room.board, [result.changeset], 30)] : []
  lines.push(...result.notes)
  lines.push(...catchUp(room, agent))
  return lines.join('\n')
}

/** A PNG of the board, cropped to the scope (everything inside that area shows, the human's ink too). */
export function look(room: Room, q: URLSearchParams): string {
  const board: Board = room.board
  const scope = q.get('scope')
  const ids = scopeIds(room, scope)
  let bounds = scope === 'view' ? room.presence?.view : ids && union(board.shapes.filter((s) => ids.has(s.id) && s.kind !== 'arrow'))
  if (bounds && scope !== 'view') bounds = inflate(bounds, 40)
  const highlight = new Set(lint(board).flatMap((p) => p.ids))
  const badges = q.get('badges') !== '0'
  const { png, width, height } = renderPng(board, { bounds, badges, highlight: q.get('highlight') === '0' ? undefined : highlight })
  const file = writePng(`${room.path}-r${board.rev}${scope ? `-${scope}` : ''}${badges ? '' : '-plain'}`, png)
  const notes = [`${width}x${height}px · rev ${board.rev}`]
  if (badges) notes.push('orange tags are shape ids, blue tags arrow ids')
  if (highlight.size) notes.push('red outlines mark problems')
  return `${file}\n${notes.join(' · ')}`
}

/**
 * Blocks until the human changes the board (then 2.5s of quiet), or until the timeout.
 * Resolves null on timeout; the CLI asks again until its own timeout runs out.
 */
export function wait(room: Room, q: URLSearchParams, signal: AbortSignal): Promise<string | null> {
  const agent = q.get('agent') ?? 'claude'
  const timeout = Math.min(Number(q.get('timeout') ?? 240), 240) * 1000
  const seen = seenBy(room, agent) ?? room.board.rev
  markSeen(room, agent, seen)
  const report = () => {
    const lines = humanChangesSince(room.board, seen)
    markSeen(room, agent)
    return [
      `the human changed "${room.path}" (rev ${seen} → ${room.board.rev}):`,
      ...lines.map((l) => `- ${l}`),
      selectionLine(room, agent),
      `run: libreta read "${room.path}"  (for the whole board)`,
    ].join('\n')
  }
  if (humanChangesSince(room.board, seen).length) return Promise.resolve(report())

  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined
    const finish = (text: string | null) => {
      clearTimeout(quiet)
      clearTimeout(timer)
      room.waiters.delete(wake)
      resolve(text)
    }
    const wake = () => {
      clearTimeout(quiet)
      quiet = setTimeout(() => finish(report()), 2500)
    }
    const timer = setTimeout(() => finish(null), timeout)
    room.waiters.add(wake)
    signal.addEventListener('abort', () => finish(null))
  })
}

const GUIDE = fileURLToPath(new URL('../../.claude/skills/libreta/SKILL.md', import.meta.url))

export function guide(): string {
  return readFileSync(GUIDE, 'utf8').replace(/^---[\s\S]*?---\n/, '').trim()
}

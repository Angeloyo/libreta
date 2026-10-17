// Open boards live in memory as "rooms": the board, the browsers showing it, what the human
// is looking at, and what each agent has already seen. The server is the source of truth.

import type { WebSocket } from 'ws'
import { apply, type ApplyContext, type ApplyResult } from '../core/apply.ts'
import type { Author, Board, Changeset } from '../core/model.ts'
import { revert, type RevertResult } from '../core/revert.ts'
import { UserError } from './errors.ts'
import type { Op } from '../core/ops.ts'
import type { Presence } from '../core/view.ts'
import { loadBoard, saveBoard } from './library.ts'

export interface Room {
  path: string
  board: Board
  clients: Set<WebSocket>
  presence?: Presence
  /** Per agent name: the last rev it saw, and the selection it last heard about. */
  seen: Map<string, number>
  seenSelection: Map<string, string[]>
  /** Called after every human changeset (used by `libreta wait`). */
  waiters: Set<(cs: Changeset) => void>
  saveTimer?: ReturnType<typeof setTimeout>
}

const rooms = new Map<string, Room>()
/** The board the human most recently had in front of them. */
let active: string | undefined

export function getRoom(path: string): Room {
  let room = rooms.get(path)
  if (!room) {
    room = { path, board: loadBoard(path), clients: new Set(), seen: new Map(), seenSelection: new Map(), waiters: new Set() }
    rooms.set(path, room)
  }
  return room
}

export function activeBoard(): string | undefined {
  return active
}

export function setActive(path: string): void {
  active = path
}

/** Applies ops, then saves, broadcasts and wakes waiters. */
export function applyToRoom(room: Room, ops: Op[], ctx: ApplyContext): ApplyResult {
  const result = apply(room.board, ops, ctx)
  if (!result.ok || !result.changeset) return result
  room.board = result.board
  broadcast(room, syncMessage(room))
  scheduleSave(room)
  if (result.changeset.by === 'human') for (const wake of room.waiters) wake(result.changeset)
  return result
}

/** Undoes changeset `rev` (by anyone) as a new changeset by `by`. */
export function revertInRoom(room: Room, rev: number, by: Author): RevertResult {
  const target = room.board.log.find((cs) => cs.rev === rev)
  if (!target) throw new UserError(`no change with rev ${rev} in the recent history`)
  const result = revert(room.board, target, by)
  if (!result.changeset) return result
  room.board = result.board
  broadcast(room, syncMessage(room))
  scheduleSave(room)
  if (by === 'human') for (const wake of room.waiters) wake(result.changeset)
  return result
}

export function syncMessage(room: Room) {
  const { board } = room
  return { type: 'sync', path: room.path, name: board.name, rev: board.rev, shapes: board.shapes, last: board.log.at(-1)?.by }
}

export function broadcast(room: Room, message: object): void {
  const data = JSON.stringify(message)
  for (const ws of room.clients) if (ws.readyState === ws.OPEN) ws.send(data)
}

function scheduleSave(room: Room): void {
  clearTimeout(room.saveTimer)
  room.saveTimer = setTimeout(() => saveBoard(room.path, room.board), 300)
}

export function flushAll(): void {
  for (const room of rooms.values()) {
    clearTimeout(room.saveTimer)
    saveBoard(room.path, room.board)
  }
}

/** A board was renamed or moved on disk: keep its room (clients, presence) under the new path. */
export function renameRoom(from: string, to: string): void {
  for (const [path, room] of rooms) {
    if (path !== from && !path.startsWith(from + '/')) continue
    rooms.delete(path)
    room.path = to + path.slice(from.length)
    room.board.name = room.path.split('/').pop()!
    rooms.set(room.path, room)
    broadcast(room, { type: 'renamed', from: path, to: room.path })
    broadcast(room, syncMessage(room))
    if (active === path) active = room.path
  }
}

export function closeRoom(path: string): void {
  for (const [p, room] of rooms) {
    if (p !== path && !p.startsWith(path + '/')) continue
    clearTimeout(room.saveTimer)
    broadcast(room, { type: 'gone', path: p })
    rooms.delete(p)
    if (active === p) active = undefined
  }
}

export function allRooms(): Room[] {
  return [...rooms.values()]
}

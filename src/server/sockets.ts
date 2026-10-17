// Browsers connect over WebSocket. Each shows one board at a time; the server sends the whole
// board on every change (boards are small), and the browser sends ops and what the human sees.

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { parseOps } from '../core/ops.ts'
import { tree } from './library.ts'
import { applyToRoom, getRoom, revertInRoom, setActive, syncMessage, type Room } from './rooms.ts'

const wss = new WebSocketServer({ noServer: true })
const sockets = new Set<WebSocket>()
let lastActive: WebSocket | undefined
const roomOf = new Map<WebSocket, Room>()

type ClientMessage =
  | { type: 'open'; path: string }
  | { type: 'ops'; ops: unknown[]; label?: string }
  | { type: 'undo'; rev: number; as: 'undo' | 'redo' }
  | { type: 'presence'; view?: { x: number; y: number; w: number; h: number }; selection?: string[]; cursor?: [number, number] }

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws)
    ws.send(JSON.stringify({ type: 'library', tree: tree() }))
    ws.on('message', (data) => onMessage(ws, JSON.parse(String(data)) as ClientMessage))
    ws.on('close', () => {
      sockets.delete(ws)
      roomOf.get(ws)?.clients.delete(ws)
      roomOf.delete(ws)
      if (lastActive === ws) lastActive = [...sockets].at(-1)
    })
  })
}

function onMessage(ws: WebSocket, msg: ClientMessage): void {
  try {
    if (msg.type === 'open') {
      roomOf.get(ws)?.clients.delete(ws)
      const room = getRoom(msg.path)
      room.clients.add(ws)
      roomOf.set(ws, room)
      setActive(room.path)
      lastActive = ws
      ws.send(JSON.stringify(syncMessage(room)))
      return
    }
    const room = roomOf.get(ws)
    if (!room) return
    if (msg.type === 'presence') {
      room.presence = { view: msg.view, selection: msg.selection, cursor: msg.cursor }
      setActive(room.path)
      lastActive = ws
    } else if (msg.type === 'ops') {
      const parsed = parseOps(msg.ops)
      const result = parsed.errors.length ? undefined : applyToRoom(room, parsed.ops, { by: 'human', label: msg.label })
      const errors = parsed.errors.length ? parsed.errors : result?.errors ?? []
      if (errors.length) {
        // Undo the browser's optimistic change by resending the real board.
        ws.send(JSON.stringify({ type: 'error', errors }))
        ws.send(JSON.stringify(syncMessage(room)))
      } else if (result?.changeset) ws.send(JSON.stringify({ type: 'applied', rev: result.changeset.rev, as: 'edit' }))
    } else if (msg.type === 'undo') {
      const result = revertInRoom(room, msg.rev, 'human')
      if (result.changeset) ws.send(JSON.stringify({ type: 'applied', rev: result.changeset.rev, as: msg.as }))
      else ws.send(JSON.stringify({ type: 'error', errors: result.notes }))
    }
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', errors: [(e as Error).message] }))
  }
}

/** Tells every browser the library changed. */
export function broadcastLibrary(): void {
  const data = JSON.stringify({ type: 'library', tree: tree() })
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data)
}

/** Shows a board in the browser the human used last. Returns false if no browser is connected. */
export function navigate(path: string): boolean {
  const ws = lastActive && lastActive.readyState === lastActive.OPEN ? lastActive : [...sockets].at(-1)
  if (!ws) return false
  ws.send(JSON.stringify({ type: 'navigate', path }))
  return true
}

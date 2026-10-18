// The browser's state: the library, the open board, and the connection to the server.
// Edits are applied locally first (same engine as the server), then sent as ops.

import { useSyncExternalStore } from 'react'
import { apply } from '../core/apply.ts'
import type { Board, Rect, Shape } from '../core/model.ts'
import type { Op } from '../core/ops.ts'
import type { HistoryEntry } from '../core/history.ts'
import type { Entry } from '../server/library.ts'

export interface State {
  connected: boolean
  library: Entry[]
  /** Path of the open board, e.g. "Work/Checkout flow". */
  path?: string
  board?: Board
  /** Who made the latest change: lets the canvas animate the agent's work. */
  lastBy?: 'human' | 'agent'
  /** The agent's most recent change, for the "undo Claude" button. */
  agentRev?: number
  errors: string[]
  /** Who did what on this board, oldest first (loaded when the history panel opens). */
  history?: { oldest: number; entries: HistoryEntry[] }
  historyOpen: boolean
  /** The board as it was at an earlier rev, shown read-only while looking through history. */
  preview?: { rev: number; board: Board }
}

let state: State = { connected: false, library: [], errors: [], historyOpen: false }
const listeners = new Set<() => void>()
let socket: WebSocket | undefined
/** What the human is looking at and has selected; sent to the server for the agent. */
let presence: { view?: Rect; selection?: string[] } = {}

function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useStore(): State {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
}

export const getState = () => state

function send(message: object): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

type ServerMessage =
  | { type: 'library'; tree: Entry[] }
  | { type: 'sync'; path: string; name: string; rev: number; shapes: Shape[]; last?: 'human' | 'agent'; entry?: HistoryEntry }
  | { type: 'navigate'; path: string }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'gone'; path: string }
  | { type: 'error'; errors: string[] }
  | { type: 'applied'; rev: number; as: 'edit' | 'undo' | 'redo' }
  | { type: 'history'; path: string; oldest: number; entries: HistoryEntry[] }
  | { type: 'preview'; path: string; rev: number; shapes: Shape[] | null }

export function connect(): void {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  socket = new WebSocket(url)
  socket.onopen = () => {
    set({ connected: true })
    if (state.path) {
      send({ type: 'open', path: state.path })
      send({ type: 'presence', ...presence })
    }
  }
  socket.onclose = () => {
    set({ connected: false })
    setTimeout(connect, 1000)
  }
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data) as ServerMessage
    if (msg.type === 'library') set({ library: msg.tree })
    else if (msg.type === 'sync') {
      if (msg.path !== state.path) return // a late message from the board we just left
      const history = state.history
      const fresh = history && msg.entry && msg.entry.rev > (history.entries.at(-1)?.rev ?? -1)
      set({
        board: { name: msg.name, rev: msg.rev, shapes: msg.shapes, log: [] },
        lastBy: msg.last,
        agentRev: msg.last === 'agent' ? msg.rev : state.agentRev,
        history: fresh ? { ...history, entries: [...history.entries, msg.entry!] } : history,
      })
    } else if (msg.type === 'renamed' && msg.from === state.path) {
      set({ path: msg.to })
      history.replaceState(null, '', toHash(msg.to))
    } else if (msg.type === 'navigate') location.hash = toHash(msg.path)
    else if (msg.type === 'gone' && msg.path === state.path) {
      location.hash = ''
      set({ path: undefined, board: undefined })
    } else if (msg.type === 'error') set({ errors: msg.errors })
    else if (msg.type === 'history' && msg.path === state.path) set({ history: { oldest: msg.oldest, entries: msg.entries } })
    else if (msg.type === 'preview' && msg.path === state.path && msg.rev === wantedPreview && state.board) {
      set({ preview: msg.shapes ? { rev: msg.rev, board: { ...state.board, rev: msg.rev, shapes: msg.shapes } } : undefined })
    } else if (msg.type === 'applied') {
      // Our own change landed: remember it so ⌘Z can undo it.
      if (msg.as === 'undo') redoStack.push(msg.rev)
      else undoStack.push(msg.rev)
      if (msg.as === 'edit') redoStack.length = 0
    }
  }
}

export function openBoard(path: string | undefined): void {
  if (path === state.path) return
  set({ path, board: undefined, errors: [], agentRev: undefined, history: undefined, preview: undefined })
  wantedPreview = undefined
  presence = {}
  undoStack.length = redoStack.length = 0
  if (path) send({ type: 'open', path })
}

/** Applies a human edit locally right away, and sends it to the server. */
export function edit(ops: Op[], label?: string): void {
  if (!state.board || !ops.length) return
  const result = apply(state.board, ops, { by: 'human', label })
  if (!result.ok) {
    set({ errors: result.errors })
    return
  }
  set({ board: result.board, lastBy: 'human', errors: [] })
  send({ type: 'ops', ops, label })
}

// Revs of this browser's own changes (and of its undos), newest last.
const undoStack: number[] = []
const redoStack: number[] = []

export function undo(): void {
  const rev = undoStack.pop()
  if (rev !== undefined) send({ type: 'undo', rev, as: 'undo' })
}

export function redo(): void {
  const rev = redoStack.pop()
  if (rev !== undefined) send({ type: 'undo', rev, as: 'redo' })
}

/** Rejects the agent's latest change (sent as a human undo, so it can itself be undone). */
export function undoAgent(rev: number): void {
  send({ type: 'undo', rev, as: 'edit' })
}

// ---- History ----

let wantedPreview: number | undefined

export function toggleHistory(): void {
  const open = !state.historyOpen
  set({ historyOpen: open })
  if (open) send({ type: 'history' })
  else showRev(undefined)
}

/** Shows the board as it was at `rev` (read-only), or the live board again with undefined. */
export function showRev(rev: number | undefined): void {
  wantedPreview = rev === state.board?.rev ? undefined : rev
  if (wantedPreview === undefined) set({ preview: undefined })
  else send({ type: 'preview', rev: wantedPreview })
}

/** Makes the board look like it did at `rev`, as a new change (so it can be undone). */
export function restoreRev(rev: number): void {
  send({ type: 'restore', rev })
  showRev(undefined)
}

let presenceTimer: ReturnType<typeof setTimeout> | undefined

/** Tells the server what the human is looking at and has selected (throttled). */
export function reportPresence(patch: { view?: Rect; selection?: string[] }): void {
  presence = { ...presence, ...patch }
  if (presenceTimer) return
  presenceTimer = setTimeout(() => {
    presenceTimer = undefined
    send({ type: 'presence', ...presence })
  }, 250)
}

export const toHash = (path: string) => '#/' + path.split('/').map(encodeURIComponent).join('/')
export const fromHash = (hash: string) => decodeURIComponent(hash.replace(/^#\/?/, '')) || undefined

export async function libraryAction(action: string, body: { path?: string; to?: string }): Promise<string> {
  const res = await fetch('/api/library', { method: 'POST', body: JSON.stringify({ action, ...body }) })
  const text = await res.text()
  if (!res.ok) throw new Error(text)
  return text
}

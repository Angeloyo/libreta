// The human's hands: tools, selection, dragging, resizing, drawing and text editing.
// Gestures preview locally; when one ends, it becomes ordinary ops (the same ones the agent uses).

import { routeArrow } from '../../core/arrows.ts'
import { center, inflate, type Point } from '../../core/geometry.ts'
import { descendants, moveTo } from '../../core/layout.ts'
import { childrenOf, getShape, nextId, type Board, type Kind, type Rect, type Shape } from '../../core/model.ts'
import type { Op } from '../../core/ops.ts'
import { FONT_FAMILY, fontSizeOf, LINE_HEIGHT, textArea } from '../../core/text.ts'
import { frameAt, shapeAt, shapesIn } from './hit.ts'
import { redo, undo } from '../store.ts'
import type { CanvasView } from './view.ts'

export type Tool = 'select' | 'hand' | 'box' | 'ellipse' | 'diamond' | 'arrow' | 'text' | 'sticky' | 'frame' | 'pen'
export type StylePatch = Partial<Pick<Shape, 'color' | 'fill' | 'stroke' | 'size'>>

export const SHORTCUTS: Record<string, Tool> = { v: 'select', h: 'hand', r: 'box', o: 'ellipse', d: 'diamond', a: 'arrow', t: 'text', n: 'sticky', f: 'frame', p: 'pen' }
const SVG = 'http://www.w3.org/2000/svg'
const BLUE = '#2563eb'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
type Gesture =
  | { type: 'pan'; sx: number; sy: number; cam: CanvasView['cam'] }
  | { type: 'move'; start: Point; ids: string[]; moved: boolean }
  | { type: 'resize'; id: string; corner: Corner; orig: Rect }
  | { type: 'marquee'; start: Point; end: Point; add: boolean }
  | { type: 'create'; kind: Kind; start: Point; end: Point }
  | { type: 'arrow'; start: Point; end: Point; from?: string }
  | { type: 'pen'; points: number[][] }

export class Editor {
  tool: Tool = 'select'
  selection: string[] = []
  private view: CanvasView
  private board: () => Board | undefined
  private edit: (ops: Op[], label?: string) => void
  private gesture?: Gesture
  private preview?: Board
  private space = false
  private textarea?: HTMLTextAreaElement
  private listeners = new Set<() => void>()

  constructor(view: CanvasView, board: () => Board | undefined, edit: (ops: Op[], label?: string) => void) {
    this.view = view
    this.board = board
    this.edit = edit
    const root = view.root
    view.listen(root, 'pointerdown', (e) => this.down(e as PointerEvent))
    view.listen(root, 'pointermove', (e) => this.move(e as PointerEvent))
    view.listen(root, 'pointerup', (e) => this.up(e as PointerEvent))
    view.listen(root, 'dblclick', (e) => this.doubleClick(e as MouseEvent))
    view.listen(window, 'keydown', (e) => this.key(e as KeyboardEvent, true))
    view.listen(window, 'keyup', (e) => this.key(e as KeyboardEvent, false))
    view.onCameraChanged.push(() => this.drawOverlay())
  }

  // ---- State that the toolbar shows ----

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(): void {
    for (const fn of this.listeners) fn()
    this.drawOverlay()
  }

  setTool(tool: Tool): void {
    this.tool = tool
    this.view.root.dataset.tool = tool
    this.changed()
  }

  select(ids: string[]): void {
    this.selection = ids
    this.changed()
    this.onSelect?.(ids)
  }

  onSelect?: (ids: string[]) => void

  /** The board changed underneath (an edit, or the agent): drop selected shapes that are gone. */
  boardChanged(): void {
    const board = this.board()
    if (!board) return
    const kept = this.selection.filter((id) => getShape(board, id))
    if (kept.length !== this.selection.length) this.select(kept)
    else this.drawOverlay()
  }

  /** True while the human is in the middle of a gesture or typing (the camera shouldn't jump). */
  busy(): boolean {
    return !!this.gesture || !!this.textarea
  }

  selectedShapes(): Shape[] {
    const board = this.board()
    return board ? this.selection.map((id) => getShape(board, id)).filter((s): s is Shape => !!s) : []
  }

  style(patch: StylePatch): void {
    const ops: Op[] = this.selection.map((id) => ({ op: 'update', id, ...patch }) as Op)
    this.edit(ops, 'style')
  }

  deleteSelection(): void {
    const board = this.board()
    if (!board || !this.selection.length) return
    const ids = topLevel(board, this.selection)
    this.select([])
    this.edit(ids.map((id) => ({ op: 'delete', id })), 'delete')
  }

  // ---- Pointer ----

  private tolerance(): number {
    return 6 / this.view.cam.zoom
  }

  private down(e: PointerEvent): void {
    if (this.textarea) this.finishEditing(true)
    const board = this.board()
    if (!board) return
    try {
      this.view.root.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic events (tests) have no real pointer to capture.
    }
    this.view.stopAnimation()
    if (e.button === 1 || this.space || this.tool === 'hand') {
      this.gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, cam: this.view.cam }
      this.view.root.classList.add('panning')
      return
    }
    const p = this.view.pointAt(e)
    if (this.tool === 'select') {
      const corner = this.cornerAt(p)
      if (corner) {
        const s = this.selectedShapes()[0]
        this.gesture = { type: 'resize', id: s.id, corner, orig: { x: s.x, y: s.y, w: s.w, h: s.h } }
        return
      }
      const hit = shapeAt(board, p, this.tolerance())
      if (hit) {
        if (e.shiftKey) this.select(this.selection.includes(hit.id) ? this.selection.filter((id) => id !== hit.id) : [...this.selection, hit.id])
        else if (!this.selection.includes(hit.id)) this.select([hit.id])
        this.gesture = { type: 'move', start: p, ids: [...this.selection], moved: false }
      } else {
        if (!e.shiftKey) this.select([])
        this.gesture = { type: 'marquee', start: p, end: p, add: e.shiftKey }
      }
    } else if (this.tool === 'arrow') {
      const from = shapeAt(board, p, this.tolerance(), (s) => s.kind === 'arrow')
      this.gesture = { type: 'arrow', start: p, end: p, from: from?.id }
    } else if (this.tool === 'pen') {
      this.gesture = { type: 'pen', points: [[p[0], p[1], e.pointerType === 'pen' ? e.pressure : 0.5]] }
    } else if (this.tool !== 'text') {
      this.gesture = { type: 'create', kind: this.tool, start: p, end: p }
    }
  }

  private move(e: PointerEvent): void {
    const g = this.gesture
    if (!g) return
    if (g.type === 'pan') {
      const z = this.view.cam.zoom
      this.view.setCamera({ ...g.cam, x: g.cam.x - (e.clientX - g.sx) / z, y: g.cam.y - (e.clientY - g.sy) / z })
      return
    }
    const p = this.view.pointAt(e)
    if (g.type === 'move') {
      const [dx, dy] = [p[0] - g.start[0], p[1] - g.start[1]]
      if (!g.moved && Math.hypot(dx, dy) * this.view.cam.zoom < 3) return
      g.moved = true
      this.preview = movedBoard(this.board()!, g.ids, dx, dy)
      this.view.setBoard(this.preview)
    } else if (g.type === 'resize') {
      this.preview = structuredClone(this.board()!)
      const s = getShape(this.preview, g.id)!
      Object.assign(s, resized(g.orig, g.corner, p), { auto: undefined })
      this.view.setBoard(this.preview)
    } else if (g.type === 'pen') {
      g.points.push([p[0], p[1], e.pointerType === 'pen' ? e.pressure : 0.5])
    } else {
      g.end = p
    }
    this.drawOverlay()
  }

  private up(e: PointerEvent): void {
    const g = this.gesture
    this.gesture = undefined
    this.view.root.classList.remove('panning')
    const board = this.board()
    if (!g || !board || g.type === 'pan') return
    const preview = this.preview
    this.preview = undefined
    const p = this.view.pointAt(e)

    if (g.type === 'move') {
      if (g.moved && preview) this.edit(dropOps(board, preview, g.ids), 'move')
    } else if (g.type === 'resize' && preview) {
      const s = getShape(preview, g.id)!
      this.edit([{ op: 'update', id: g.id, w: Math.round(s.w), h: Math.round(s.h) }, { op: 'move', id: g.id, at: [Math.round(s.x), Math.round(s.y)] }], 'resize')
    } else if (g.type === 'marquee') {
      const ids = shapesIn(board, normalize(g.start, g.end)).map((s) => s.id)
      this.select(g.add ? [...new Set([...this.selection, ...ids])] : ids)
    } else if (g.type === 'create') {
      this.create(board, g.kind, g.start, p)
    } else if (g.type === 'arrow') {
      const to = shapeAt(board, p, this.tolerance(), (s) => s.kind === 'arrow' || s.id === g.from)
      if (Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) * this.view.cam.zoom < 8 && !to) return this.changed()
      const id = nextId(board, 'h')
      const end = (shapeId: string | undefined, pt: Point) => shapeId ?? ([Math.round(pt[0]), Math.round(pt[1])] as [number, number])
      this.edit([{ op: 'connect', id, from: end(g.from, g.start), to: end(to?.id, p) }], 'arrow')
      this.select([id])
      this.setTool('select')
    } else if (g.type === 'pen') {
      if (g.points.length > 1) this.edit([{ op: 'create', kind: 'pen', id: nextId(board, 'h'), points: g.points }], 'draw')
    }
    this.view.setBoard(this.board()!)
    this.drawOverlay()
  }

  private create(board: Board, kind: Kind, start: Point, end: Point): void {
    const id = nextId(board, 'h')
    const r = normalize(start, end)
    const dragged = r.w * this.view.cam.zoom > 8 && r.h * this.view.cam.zoom > 8
    const op: Op = dragged
      ? { op: 'create', kind: kind as 'box', id, at: [Math.round(r.x), Math.round(r.y)], w: Math.round(r.w), h: Math.round(r.h) }
      : { op: 'create', kind: kind as 'box', id, at: [Math.round(start[0]), Math.round(start[1])] }
    if (kind === 'frame') Object.assign(op, { text: 'Frame', layout: 'none' })
    const into = frameAt(board, start, new Set())
    if (into && kind !== 'frame') Object.assign(op, { in: into.id })
    if (into?.layout && into.layout !== 'none') delete (op as { at?: unknown }).at
    this.edit([op], 'create')
    this.setTool('select')
    this.select([id])
    if (kind !== 'frame') this.startEditing(id)
  }

  private doubleClick(e: MouseEvent): void {
    const board = this.board()
    if (!board || this.tool !== 'select') return
    const p = this.view.pointAt(e)
    const hit = shapeAt(board, p, this.tolerance())
    if (hit && hit.kind !== 'pen') this.startEditing(hit.id)
    else if (!hit) this.startEditing(undefined, p)
  }

  // ---- Keyboard ----

  private key(e: KeyboardEvent, down: boolean): void {
    if (this.textarea || (e.target as HTMLElement).closest?.('input, textarea')) return
    if (e.key === ' ') {
      this.space = down
      this.view.root.classList.toggle('pan-ready', down)
      e.preventDefault()
      return
    }
    if (!down) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (e.key === 'Backspace' || e.key === 'Delete') this.deleteSelection()
    else if (e.key.startsWith('Arrow') && this.selection.length) {
      e.preventDefault()
      const step = e.shiftKey ? 50 : 10
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0]
      const board = this.board()
      const ids = board ? topLevel(board, this.selection).filter((id) => getShape(board, id)?.kind !== 'arrow') : []
      this.edit(ids.map((id) => ({ op: 'move', id, by: [dx, dy] })), 'nudge')
    }
    else if (e.key === 'Escape') {
      this.select([])
      this.setTool('select')
    } else if (e.key === 'Enter' && this.selection.length === 1) {
      e.preventDefault()
      this.startEditing(this.selection[0])
    } else if (mod && e.key === 'a') {
      e.preventDefault()
      this.select(this.board()?.shapes.map((s) => s.id) ?? [])
    } else if (e.shiftKey && e.code === 'Digit1') this.view.fitToContent()
    else if (!mod && !e.altKey && SHORTCUTS[e.key]) this.setTool(SHORTCUTS[e.key])
  }

  // ---- Text editing ----

  /** Opens a text box over a shape (or, with no id, for a new text shape at `at`). */
  startEditing(id?: string, at?: Point): void {
    const board = this.board()
    if (!board) return
    const shape = id ? getShape(board, id) : undefined
    if (id && (!shape || shape.kind === 'pen')) return
    const cam = this.view.cam
    const area: Rect = shape ? (shape.kind === 'arrow' ? labelArea(board, shape) : textArea(shape)) : { x: at![0], y: at![1] - 14, w: 240, h: 28 }
    const fontSize = (shape ? fontSizeOf(shape) : 20) * cam.zoom
    const ta = document.createElement('textarea')
    ta.className = 'text-editor'
    ta.value = shape?.text ?? ''
    Object.assign(ta.style, {
      left: `${(area.x - cam.x) * cam.zoom}px`,
      top: `${(area.y - cam.y) * cam.zoom}px`,
      width: `${Math.max(area.w, 60) * cam.zoom}px`,
      height: `${Math.max(area.h * cam.zoom, fontSize * LINE_HEIGHT)}px`,
      fontFamily: FONT_FAMILY,
      fontSize: `${fontSize}px`,
      lineHeight: String(LINE_HEIGHT),
      textAlign: !shape || shape.kind === 'text' || shape.kind === 'frame' ? 'left' : 'center',
      fontWeight: shape?.kind === 'frame' ? '700' : '400',
    })
    ta.dataset.id = id ?? ''
    ta.dataset.at = at ? at.join(',') : ''
    this.view.root.append(ta)
    this.textarea = ta
    ta.focus()
    ta.select()
    // Text shapes are multi-line: Enter is a new line and ⌘Enter finishes. Labels finish on Enter.
    const multiline = !shape || shape.kind === 'text'
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') this.finishEditing(false)
      if (e.key === 'Enter' && (multiline ? e.metaKey || e.ctrlKey : !e.shiftKey)) {
        e.preventDefault()
        this.finishEditing(true)
      }
    })
    ta.addEventListener('blur', () => this.finishEditing(true))
  }

  private finishEditing(save: boolean): void {
    const ta = this.textarea
    if (!ta) return
    this.textarea = undefined
    ta.remove()
    const board = this.board()
    if (!save || !board) return
    const text = ta.value.trim() ? ta.value.replace(/\s+$/, '') : ''
    const id = ta.dataset.id
    if (id) {
      if (getShape(board, id)?.text !== text) this.edit([{ op: 'update', id, text }], 'text')
    } else if (text) {
      const [x, y] = ta.dataset.at!.split(',').map(Number)
      const newId = nextId(board, 'h')
      this.edit([{ op: 'create', kind: 'text', id: newId, text, at: [Math.round(x), Math.round(y - 14)] }], 'text')
      this.select([newId])
    }
  }

  // ---- Overlay ----

  private cornerAt(p: Point): Corner | undefined {
    const [s] = this.selectedShapes()
    if (this.selection.length !== 1 || !s || !resizable(s)) return
    const r = 8 / this.view.cam.zoom
    for (const [corner, [x, y]] of Object.entries(corners(s)) as [Corner, Point][]) {
      if (Math.abs(p[0] - x) <= r && Math.abs(p[1] - y) <= r) return corner
    }
  }

  drawOverlay(): void {
    const board = this.preview ?? this.board()
    const layer = this.view.overlay
    const z = this.view.cam.zoom
    const parts: string[] = []
    const rect = (r: Rect, attrs: string) =>
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" vector-effect="non-scaling-stroke" ${attrs}/>`)
    if (board) {
      for (const id of this.selection) {
        const s = getShape(board, id)
        if (!s) continue
        if (s.kind === 'arrow') {
          const pts = routeArrow(board, s).points.map((p) => p.join(',')).join(' ')
          parts.push(`<polyline points="${pts}" fill="none" stroke="${BLUE}" stroke-opacity="0.5" stroke-width="6" vector-effect="non-scaling-stroke"/>`)
        } else rect(inflate(s, 4 / z), `stroke="${BLUE}" stroke-width="1.5"`)
      }
      const [only] = this.selectedShapes()
      if (this.selection.length === 1 && only && resizable(only) && !this.gesture) {
        const h = 8 / z
        for (const [x, y] of Object.values(corners(only))) rect({ x: x - h / 2, y: y - h / 2, w: h, h }, `stroke="${BLUE}" stroke-width="1.5" fill="#fff" style="fill:#fff"`)
      }
    }
    const g = this.gesture
    if (g?.type === 'marquee') rect(normalize(g.start, g.end), `stroke="${BLUE}" stroke-width="1" style="fill:${BLUE};fill-opacity:0.06"`)
    if (g?.type === 'create') rect(normalize(g.start, g.end), `stroke="${BLUE}" stroke-width="1.5" stroke-dasharray="6 4"`)
    if (g?.type === 'arrow') parts.push(`<line x1="${g.start[0]}" y1="${g.start[1]}" x2="${g.end[0]}" y2="${g.end[1]}" stroke="${BLUE}" stroke-width="2" vector-effect="non-scaling-stroke"/>`)
    if (g?.type === 'pen') parts.push(`<polyline points="${g.points.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="#1e1e1e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`)
    layer.innerHTML = parts.join('')
  }
}

// ---- Helpers ----

function normalize(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }
}

const resizable = (s: Shape) => s.kind !== 'arrow' && s.kind !== 'pen' && !(s.kind === 'frame' && s.layout && s.layout !== 'none')

function corners(s: Rect): Record<Corner, Point> {
  return { nw: [s.x, s.y], ne: [s.x + s.w, s.y], sw: [s.x, s.y + s.h], se: [s.x + s.w, s.y + s.h] }
}

/** A rectangle with one corner dragged to `p` (the opposite corner stays put). */
function resized(orig: Rect, corner: Corner, p: Point): Rect {
  const fixed: Point = [corner.includes('w') ? orig.x + orig.w : orig.x, corner.includes('n') ? orig.y + orig.h : orig.y]
  const r = normalize(fixed, p)
  return { ...r, w: Math.max(20, r.w), h: Math.max(20, r.h) }
}

function labelArea(board: Board, arrow: Shape): Rect {
  const route = routeArrow(board, arrow)
  if (route.label) return route.label
  const [x, y] = route.points[Math.floor(route.points.length / 2)]
  return { x: x - 60, y: y - 14, w: 120, h: 28 }
}

/** Selected shapes without their selected ancestors (moving a frame moves its children). */
function topLevel(board: Board, ids: string[]): string[] {
  const set = new Set(ids)
  return ids.filter((id) => {
    for (let p = getShape(board, id)?.parent; p; p = getShape(board, p)?.parent) if (set.has(p)) return false
    return true
  })
}

function movedBoard(board: Board, ids: string[], dx: number, dy: number): Board {
  const next = structuredClone(board)
  for (const id of topLevel(next, ids)) {
    const s = getShape(next, id)
    if (s && s.kind !== 'arrow') moveTo(next, s, s.x + dx, s.y + dy)
  }
  return next
}

/** Turns a finished drag into ops: new positions, plus moving into or out of frames. */
function dropOps(board: Board, preview: Board, ids: string[]): Op[] {
  const ops: Op[] = []
  for (const id of topLevel(board, ids)) {
    const moved = getShape(preview, id)
    if (!moved || moved.kind === 'arrow') continue
    const skip = new Set([id, ...descendants(preview, id).map((s) => s.id)])
    const target = frameAt(preview, center(moved), skip)
    const parent = target?.id
    const at: [number, number] = [Math.round(moved.x), Math.round(moved.y)]
    if (target?.layout && target.layout !== 'none') {
      // Dropped into a layout frame: the frame places it; we only choose its order.
      const siblings = childrenOf(preview, target.id).filter((s) => s.id !== id && s.kind !== 'arrow')
      const key = (s: Rect) => (target.layout === 'row' ? center(s)[0] : center(s)[1])
      const before = siblings.find((s) => key(s) > key(moved))
      ops.push(before ? { op: 'move', id, in: parent, before: before.id } : siblings.length ? { op: 'move', id, in: parent, after: siblings.at(-1)!.id } : { op: 'move', id, in: parent })
    } else if (parent !== moved.parent) ops.push({ op: 'move', id, in: parent ?? null, at })
    else ops.push({ op: 'move', id, at })
  }
  return ops
}

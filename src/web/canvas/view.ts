// The canvas: an SVG that draws the board with the shared renderer and moves a camera over it.
// Each shape is its own <g>, re-rendered only when that shape (or an arrow's ends) changed.

import { getShape, type Board, type Rect, type Shape } from '../../core/model.ts'
import { boardBounds, drawOrder, renderShape } from '../../core/render.ts'
import { fit, toBoard, visibleRect, zoomAt, type Camera } from './camera.ts'

const SVG = 'http://www.w3.org/2000/svg'
const GRID = 24

export class CanvasView {
  readonly root: HTMLElement
  readonly svg: SVGSVGElement
  /** Board coordinates live inside this group; its transform is the camera. */
  readonly world: SVGGElement
  readonly shapesLayer: SVGGElement
  /** Selection boxes, handles, previews: drawn above the shapes. */
  readonly overlay: SVGGElement
  cam: Camera = { x: 0, y: 0, zoom: 1 }
  board?: Board
  /** Called whenever the camera moves. */
  onCameraChanged: (() => void)[] = []
  private rendered = new Map<string, { el: SVGGElement; key: string }>()
  private cleanup: (() => void)[] = []

  constructor(root: HTMLElement) {
    this.root = root
    this.svg = document.createElementNS(SVG, 'svg')
    this.world = document.createElementNS(SVG, 'g')
    this.shapesLayer = document.createElementNS(SVG, 'g')
    this.overlay = document.createElementNS(SVG, 'g')
    this.world.append(this.shapesLayer, this.overlay)
    this.svg.append(this.world)
    root.append(this.svg)
    this.listen(root, 'wheel', (e) => this.wheel(e as WheelEvent), { passive: false })
    this.listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') for (const el of this.shapesLayer.querySelectorAll('.appear')) el.classList.remove('appear')
    })
    const resize = new ResizeObserver(() => this.applyCamera())
    resize.observe(root)
    this.cleanup.push(() => resize.disconnect())
  }

  listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts)
    this.cleanup.push(() => target.removeEventListener(type, fn, opts))
  }

  destroy(): void {
    for (const fn of this.cleanup) fn()
    this.svg.remove()
  }

  get size(): { w: number; h: number } {
    return { w: this.root.clientWidth, h: this.root.clientHeight }
  }

  /** Board coordinates under a pointer event. */
  pointAt(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.root.getBoundingClientRect()
    return toBoard(this.cam, e.clientX - r.left, e.clientY - r.top)
  }

  setCamera(cam: Camera): void {
    this.cam = cam
    this.applyCamera()
  }

  fitToContent(): void {
    const bounds = this.board && boardBounds(this.board)
    const { w, h } = this.size
    this.setCamera(bounds ? fit(bounds, w, h) : { x: -w / 2, y: -h / 2, zoom: 1 })
  }

  visible() {
    return visibleRect(this.cam, this.size.w, this.size.h)
  }

  private applyCamera(): void {
    const { x, y, zoom } = this.cam
    this.world.setAttribute('transform', `scale(${zoom}) translate(${-x} ${-y})`)
    const size = GRID * zoom
    this.root.style.backgroundSize = `${size}px ${size}px`
    this.root.style.backgroundPosition = `${-x * zoom}px ${-y * zoom}px`
    for (const fn of this.onCameraChanged) fn()
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault()
    this.stopAnimation()
    const r = this.root.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      // Pinch on a trackpad arrives as ctrl+wheel.
      this.setCamera(zoomAt(this.cam, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top))
    } else {
      this.setCamera({ ...this.cam, x: this.cam.x + e.deltaX / this.cam.zoom, y: this.cam.y + e.deltaY / this.cam.zoom })
    }
  }

  /**
   * Draws the board and returns the shapes that changed (arrows aside).
   * With `animate`, shapes that are new appear one after another.
   */
  setBoard(board: Board, animate = false): Shape[] {
    this.board = board
    // Hidden tabs pause CSS animations, which would leave new shapes invisible.
    animate &&= document.visibilityState === 'visible'
    const seen = new Set<string>()
    const changed: Shape[] = []
    let appearing = 0
    for (const shape of drawOrder(board)) {
      seen.add(shape.id)
      const key = renderKey(board, shape)
      let entry = this.rendered.get(shape.id)
      if (!entry) {
        entry = { el: document.createElementNS(SVG, 'g'), key: '' }
        entry.el.dataset.id = shape.id
        if (animate) {
          const el = entry.el
          const delay = appearing++ * 70
          el.classList.add('appear')
          el.style.animationDelay = `${delay}ms`
          // Throttled pages may never run the animation; make sure the shape ends up visible.
          setTimeout(() => el.classList.remove('appear'), delay + 500)
        }
        this.rendered.set(shape.id, entry)
      }
      if (entry.key !== key) {
        entry.el.innerHTML = renderShape(board, shape)
        if (animate && entry.key) glow(entry.el) // an existing shape the agent just changed
        entry.key = key
        if (shape.kind !== 'arrow') changed.push(shape)
      }
      this.shapesLayer.append(entry.el) // re-appending keeps the draw order right
    }
    for (const [id, entry] of this.rendered) {
      if (seen.has(id)) continue
      entry.el.remove()
      this.rendered.delete(id)
    }
    return changed
  }

  /** Glides the camera so `area` is in view (zooming out if needed). Does nothing if it already is. */
  reveal(area: Rect): void {
    const view = this.visible()
    const inView = area.x >= view.x && area.y >= view.y && area.x + area.w <= view.x + view.w && area.y + area.h <= view.y + view.h
    if (inView) return
    const { w, h } = this.size
    // Keep the current zoom when the area fits at it; only zoom out when it must.
    const zoom = Math.min(this.cam.zoom, fit(area, w, h, 80).zoom)
    const goal = { zoom, x: area.x + area.w / 2 - w / 2 / zoom, y: area.y + area.h / 2 - h / 2 / zoom }
    this.animateTo(goal)
  }

  private animation = 0

  animateTo(goal: Camera, ms = 450): void {
    const from = this.cam
    const start = performance.now()
    const id = ++this.animation
    const step = (now: number) => {
      if (id !== this.animation) return // a newer animation (or the human) took over
      const t = Math.min(1, (now - start) / ms)
      const e = 1 - (1 - t) ** 3
      this.setCamera({ zoom: from.zoom + (goal.zoom - from.zoom) * e, x: from.x + (goal.x - from.x) * e, y: from.y + (goal.y - from.y) * e })
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  /** Stops any camera animation (the human grabbed the camera). */
  stopAnimation(): void {
    this.animation++
  }
}

/** A brief violet glow on a shape the agent changed, so the human sees what it touched. */
function glow(el: SVGGElement): void {
  el.classList.remove('touched')
  void el.getBoundingClientRect() // restart the animation if it's already running
  el.classList.add('touched')
  setTimeout(() => el.classList.remove('touched'), 1600)
}

/** Everything that affects how a shape looks. Arrows also depend on the shapes at their ends. */
function renderKey(board: Board, shape: Shape): string {
  if (shape.layout === 'table') return JSON.stringify([shape, board.shapes.filter((c) => c.parent === shape.id)]) // it draws its cells' grid
  if (shape.kind !== 'arrow') return JSON.stringify(shape)
  const ends = [shape.from, shape.to].map((e) => (e && 'id' in e ? getShape(board, e.id) : e))
  // Arrows route around other shapes too, so any geometry change can move them.
  const geometry = board.shapes.map((s) => (s.kind === 'arrow' ? '' : `${s.x},${s.y},${s.w},${s.h}`)).join(';')
  return JSON.stringify([shape, ends]) + geometry
}

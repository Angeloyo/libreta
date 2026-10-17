// Dev-only helpers for driving the editor from automated tests (window.libreta.test).
// They dispatch real DOM pointer and key events, so they go through the same code as a mouse.

type Point = [number, number]

function pointer(type: string, [x, y]: Point, buttons: number): void {
  const target = document.elementFromPoint(x, y) ?? document.body
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', bubbles: true }))
}

export const testing = {
  /** Screen center of a shape, by id. */
  at(id: string): Point {
    const el = document.querySelector(`.canvas svg g[data-id="${id}"]`)
    if (!el) throw new Error(`no shape ${id} on screen`)
    const r = el.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height / 2]
  },
  drag(from: Point, to: Point, steps = 8): void {
    pointer('pointerdown', from, 1)
    for (let i = 1; i <= steps; i++) pointer('pointermove', [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps], 1)
    pointer('pointerup', to, 0)
  },
  path(points: Point[]): void {
    pointer('pointerdown', points[0], 1)
    for (const p of points.slice(1)) pointer('pointermove', p, 1)
    pointer('pointerup', points[points.length - 1], 0)
  },
  click(p: Point): void {
    this.drag(p, p, 1)
  },
  key(key: string, opts: KeyboardEventInit = {}): void {
    const target = document.activeElement ?? window
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }))
    target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, ...opts }))
  },
  /** Types into the open text editor and presses Enter. */
  type(text: string): void {
    const ta = document.querySelector<HTMLTextAreaElement>('.text-editor')
    if (!ta) throw new Error('no text editor open')
    ta.value = text
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
  },
}

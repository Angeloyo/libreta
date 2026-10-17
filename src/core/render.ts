// Board → SVG. The browser and the server's PNG renderer both draw with this file,
// so what the agent "looks at" is exactly what the human sees.

import rough from 'roughjs'
import { getStroke } from 'perfect-freehand'
import { routeArrow } from './arrows.ts'
import { inflate, union, type Point } from './geometry.ts'
import { COLORS, type Board, type Rect, type Shape } from './model.ts'
import { baseline, FONT_FAMILY, LINE_HEIGHT, shapeText, textArea, type TextBlock } from './text.ts'

const gen = rough.generator()
export const BACKGROUND = '#ffffff'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => Math.round(v * 100) / 100

/** A stable seed per shape, so its hand-drawn wobble is the same every time it's drawn. */
function seed(id: string): number {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0) % 2147483647 || 1
}

const DASH = { solid: undefined, dashed: '8 6', dotted: '1.5 6' }

function roughSvg(drawable: ReturnType<typeof gen.rectangle>, dash?: string): string {
  return gen
    .toPaths(drawable)
    .map((p) => {
      const stroked = p.stroke && p.stroke !== 'none'
      const dashAttr = stroked && dash ? ` stroke-dasharray="${dash}" stroke-linecap="round"` : ''
      return `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}"${dashAttr}/>`
    })
    .join('')
}

function roughOptions(s: Shape) {
  const fill = s.fill === 'light' ? COLORS[s.color].light : s.fill === 'solid' ? COLORS[s.color].solid : undefined
  return {
    seed: seed(s.id),
    roughness: 1,
    stroke: COLORS[s.color].stroke,
    strokeWidth: s.size === 'l' || s.size === 'xl' ? 2.2 : 1.6,
    fill,
    fillStyle: 'solid',
    disableMultiStroke: s.stroke !== 'solid',
  }
}

export function textSvg(block: TextBlock, area: Rect, color: string, align: 'center' | 'left' = 'center', valign: 'middle' | 'top' = 'middle'): string {
  const lineHeight = block.fontSize * LINE_HEIGHT
  const top = valign === 'top' ? area.y : area.y + (area.h - block.height) / 2
  const x = align === 'center' ? area.x + area.w / 2 : area.x
  const anchor = align === 'center' ? 'middle' : 'start'
  const weight = block.bold ? ' font-weight="700"' : ''
  return block.lines
    .map(
      (line, i) =>
        `<text x="${n(x)}" y="${n(top + i * lineHeight + baseline(block.fontSize))}" font-family="${FONT_FAMILY}" font-size="${block.fontSize}"${weight} fill="${color}" text-anchor="${anchor}" xml:space="preserve">${esc(line)}</text>`,
    )
    .join('')
}

function arrowSvg(board: Board, s: Shape): string {
  const { points, label } = routeArrow(board, s)
  const opts = { ...roughOptions(s), disableMultiStroke: true, fill: undefined }
  const dash = DASH[s.stroke]
  let out = roughSvg(gen.linearPath(points, opts), dash)
  const head = (tip: Point, from: Point) => {
    const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0])
    const len = s.size === 'l' || s.size === 'xl' ? 16 : 12
    const wing = (a: number): Point => [tip[0] - len * Math.cos(angle + a), tip[1] - len * Math.sin(angle + a)]
    return roughSvg(gen.linearPath([wing(0.45), tip, wing(-0.45)], opts))
  }
  if (s.heads !== 'none') out += head(points[points.length - 1], points[points.length - 2])
  if (s.heads === 'both') out += head(points[0], points[1])
  if (label) {
    out += `<rect x="${n(label.x)}" y="${n(label.y)}" width="${n(label.w)}" height="${n(label.h)}" rx="4" fill="${BACKGROUND}" fill-opacity="0.9"/>`
    out += textSvg(shapeText(s), label, COLORS[s.color].stroke)
  }
  return out
}

function penSvg(s: Shape): string {
  const widths = { s: 3, m: 5, l: 8, xl: 12 }
  const pts = (s.points ?? []).map(([x, y, p]) => [x + s.x, y + s.y, p ?? 0.5])
  const simulate = pts.every((p) => p[2] === 0.5)
  const outline = getStroke(pts, { size: widths[s.size], thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: simulate, last: true })
  if (outline.length < 2) return ''
  const d = outline.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)},${n(y)}`).join('') + 'Z'
  return `<path d="${d}" fill="${COLORS[s.color].stroke}"/>`
}

/** A table frame draws its own grid: lines along the cells' edges. */
function tableSvg(board: Board, s: Shape): string {
  const cells = board.shapes.filter((c) => c.parent === s.id)
  if (!cells.length) return ''
  const xs = [...new Set(cells.flatMap((c) => [c.x, c.x + c.w]))].sort((a, b) => a - b)
  const ys = [...new Set(cells.flatMap((c) => [c.y, c.y + c.h]))].sort((a, b) => a - b)
  const opts = { ...roughOptions(s), disableMultiStroke: true, roughness: 0.6, fill: undefined }
  const [x0, x1, y0, y1] = [xs[0], xs[xs.length - 1], ys[0], ys[ys.length - 1]]
  // Cell fills first (the cells themselves only draw text), then the grid on top.
  const fills = cells
    .filter((c) => c.fill !== 'none')
    .map((c) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${c.fill === 'solid' ? COLORS[c.color].solid : COLORS[c.color].light}"/>`)
  const lines = [...xs.map((x) => gen.line(x, y0, x, y1, opts)), ...ys.map((y) => gen.line(x0, y, x1, y, opts))]
  return fills.join('') + lines.map((l) => roughSvg(l)).join('')
}

const inTable = (board: Board, s: Shape) => !!s.parent && board.shapes.find((p) => p.id === s.parent)?.layout === 'table'

/** One shape as an SVG group. */
export function renderShape(board: Board, s: Shape): string {
  const color = COLORS[s.color]
  const dash = DASH[s.stroke]
  let body = ''
  if (s.kind === 'box' && inTable(board, s)) {
    // A table cell: just its text. The table draws fills and grid.
  } else if (s.kind === 'frame' && s.layout === 'table') body = tableSvg(board, s)
  else if (s.kind === 'box') body = roughSvg(gen.rectangle(s.x, s.y, s.w, s.h, roughOptions(s)), dash)
  else if (s.kind === 'ellipse') body = roughSvg(gen.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, roughOptions(s)), dash)
  else if (s.kind === 'diamond') {
    const [cx, cy] = [s.x + s.w / 2, s.y + s.h / 2]
    const corners: Point[] = [[cx, s.y], [s.x + s.w, cy], [cx, s.y + s.h], [s.x, cy]]
    body = roughSvg(gen.polygon(corners, roughOptions(s)), dash)
  } else if (s.kind === 'sticky') {
    body =
      `<rect x="${s.x + 2}" y="${s.y + 4}" width="${s.w}" height="${s.h}" rx="3" fill="#000" fill-opacity="0.07"/>` +
      `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="3" fill="${color.solid}" fill-opacity="0.6"/>`
  } else if (s.kind === 'frame') {
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
    body = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="12" fill="${color.light}" fill-opacity="0.55" stroke="${color.stroke}" stroke-opacity="0.45" stroke-width="1.2"${dashAttr}/>`
  } else if (s.kind === 'arrow') body = arrowSvg(board, s)
  else if (s.kind === 'pen') body = penSvg(s)

  if (s.text && s.kind !== 'arrow') {
    const textColor = s.kind === 'sticky' || s.kind === 'frame' ? COLORS.black.stroke : color.stroke
    const plain = s.kind === 'text' || s.kind === 'frame' // left-aligned; plain text also reads from the top
    body += textSvg(shapeText(s), textArea(s), s.kind === 'frame' ? '#374151' : textColor, plain ? 'left' : 'center', s.kind === 'text' ? 'top' : 'middle')
  }
  return `<g data-id="${esc(s.id)}">${body}</g>`
}

/** Draw order: frames (outermost first), then shapes, pen strokes, and arrows on top. */
export function drawOrder(board: Board): Shape[] {
  const depth = (s: Shape) => {
    let d = 0
    for (let p = s.parent; p; p = board.shapes.find((x) => x.id === p)?.parent) d++
    return d
  }
  const rank = (s: Shape) => (s.kind === 'frame' ? depth(s) : s.kind === 'pen' ? 100 : s.kind === 'arrow' ? 101 : 50)
  return board.shapes.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s)
}

/** Everything drawn on the board, arrows included. */
export function boardBounds(board: Board): Rect | undefined {
  const rects: Rect[] = []
  for (const s of board.shapes) {
    if (s.kind !== 'arrow') rects.push(s)
    else {
      const { points, label } = routeArrow(board, s)
      rects.push(...points.map(([x, y]) => ({ x, y, w: 0, h: 0 })))
      if (label) rects.push(label)
    }
  }
  return union(rects)
}

export interface RenderOptions {
  /** The board area to draw. Default: everything, with a margin. */
  bounds?: Rect
  /** Label every shape with its id, so a screenshot can be mapped back to the text view. */
  badges?: boolean
  /** Outline these shapes in red (e.g. the ones with problems). */
  highlight?: Set<string>
}

export function renderBoard(board: Board, opts: RenderOptions = {}): string {
  const shapes = drawOrder(board)
  const b = opts.bounds ?? inflate(boardBounds({ ...board, shapes }) ?? { x: 0, y: 0, w: 400, h: 300 }, 40)
  let body = shapes.map((s) => renderShape(board, s)).join('')
  for (const s of shapes) {
    if (opts.highlight?.has(s.id) && s.kind !== 'arrow') {
      const r = inflate(s, 6)
      body += `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="6" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="6 4"/>`
    }
  }
  if (opts.badges) body += shapes.map((s) => badge(board, s)).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(b.x)} ${n(b.y)} ${n(b.w)} ${n(b.h)}" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}">` +
    `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="${BACKGROUND}"/>${body}</svg>`
  )
}

function badge(board: Board, s: Shape): string {
  if (inTable(board, s)) return '' // cells are named after their table (urls-r2c1)
  let x = s.x
  let y = s.y - 18
  if (s.kind === 'arrow') {
    const { points, label } = routeArrow(board, s)
    const mid = label ? [label.x + label.w, label.y] : points[Math.floor(points.length / 2)]
    ;[x, y] = [mid[0] + 2, mid[1] - 16]
  }
  const w = s.id.length * 7 + 10
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${w}" height="16" rx="4" fill="${s.kind === 'arrow' ? '#0ea5e9' : '#f97316'}"/>` +
    `<text x="${n(x + w / 2)}" y="${n(y + 12)}" font-family="${FONT_FAMILY}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${esc(s.id)}</text>`
  )
}

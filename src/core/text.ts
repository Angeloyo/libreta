// Text measurement from the font's own advance widths (see scripts/font-metrics.ts).
// The fonts ship without kerning, so these numbers match what the browser and resvg draw.

import metrics from './font-metrics.json' with { type: 'json' }
import { FONT_SIZE, type Rect, type Shape } from './model.ts'

const UPM = metrics.unitsPerEm
const widths = { regular: metrics.regular as Record<string, number>, bold: metrics.bold as Record<string, number> }
const FALLBACK = 600 // width of a character the font doesn't have, in font units

export const LINE_HEIGHT = 1.3
export const FONT_FAMILY = 'Shantell Sans'

export function textWidth(text: string, fontSize: number, bold = false): number {
  const table = bold ? widths.bold : widths.regular
  let units = 0
  for (const ch of text) units += table[ch] ?? FALLBACK
  return (units * fontSize) / UPM
}

/** Distance from the top of a line box to the text baseline. */
export function baseline(fontSize: number): number {
  const ascent = metrics.ascender / UPM
  const descent = -metrics.descender / UPM
  return ((LINE_HEIGHT - ascent - descent) / 2 + ascent) * fontSize
}

/** Characters the board font can't draw (they'd show as blank space). */
export function missingGlyphs(text: string): string[] {
  return [...new Set([...text].filter((ch) => ch !== '\n' && !(ch in widths.regular)))]
}

// Where a long word (a URL, a path) may break: after these characters.
const BREAK_AFTER = new Set(['/', '?', '&', '.', '-', '_', '=', ':', ','])

/** Word-wraps text to maxWidth, keeping explicit line breaks. Long words are split, at "/" or "." if possible. */
export function wrap(text: string, maxWidth: number, fontSize: number, bold = false): string[] {
  maxWidth += 0.01 // absorb float error when the width was computed from this same text
  const fits = (t: string) => textWidth(t, fontSize, bold) <= maxWidth
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? line + ' ' + word : word
      if (fits(candidate)) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = word
      // A single word wider than the line: break it into pieces.
      while (!fits(line) && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && !fits(line.slice(0, cut))) cut--
        let nice = cut
        while (nice > 1 && !BREAK_AFTER.has(line[nice - 1])) nice--
        if (nice > cut / 2) cut = nice
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    lines.push(line)
  }
  return lines
}

export interface TextBlock {
  lines: string[]
  fontSize: number
  bold: boolean
  width: number
  height: number
}

export function layoutText(text: string, fontSize: number, maxWidth: number, bold = false): TextBlock {
  const lines = text ? wrap(text, maxWidth, fontSize, bold) : []
  const width = Math.max(0, ...lines.map((l) => textWidth(l, fontSize, bold)))
  return { lines, fontSize, bold, width, height: lines.length * fontSize * LINE_HEIGHT }
}

// How each kind holds its text: padding, minimum size, and the widest a line may grow
// before wrapping (in multiples of the font size).
const SPEC: Record<string, { pad: number; minW: number; minH: number; maxLine: number }> = {
  box: { pad: 16, minW: 120, minH: 60, maxLine: 12 },
  ellipse: { pad: 10, minW: 140, minH: 70, maxLine: 10 },
  diamond: { pad: 8, minW: 140, minH: 90, maxLine: 8 },
  text: { pad: 0, minW: 10, minH: 10, maxLine: 24 },
  sticky: { pad: 16, minW: 200, minH: 200, maxLine: 8.4 },
  frame: { pad: 0, minW: 0, minH: 0, maxLine: 40 },
  arrow: { pad: 4, minW: 0, minH: 0, maxLine: 14 },
  pen: { pad: 0, minW: 0, minH: 0, maxLine: 0 },
}

export const FRAME_PAD = 30

export function fontSizeOf(shape: Shape): number {
  if (shape.kind === 'arrow') return FONT_SIZE[shape.size] - 4
  return FONT_SIZE[shape.size]
}

/** Height of a frame's title bar (0 without a title). Its size follows the frame's `size`. */
export function titleBand(frame: Shape): number {
  return frame.text ? Math.round(fontSizeOf(frame) * LINE_HEIGHT + 16) : 0
}

/** Where a frame's content starts, below its title. */
export function contentTop(frame: Shape): number {
  return frame.text ? titleBand(frame) + 10 : FRAME_PAD
}

/** The rectangle text is laid out in. Ellipses and diamonds use their inscribed rectangle. */
export function textArea(shape: Shape): Rect {
  const { pad } = SPEC[shape.kind]
  if (shape.kind === 'ellipse') {
    const w = shape.w / Math.SQRT2
    const h = shape.h / Math.SQRT2
    return { x: shape.x + (shape.w - w) / 2 + pad, y: shape.y + (shape.h - h) / 2 + pad, w: w - 2 * pad, h: h - 2 * pad }
  }
  if (shape.kind === 'diamond') {
    return { x: shape.x + shape.w / 4 + pad, y: shape.y + shape.h / 4 + pad, w: shape.w / 2 - 2 * pad, h: shape.h / 2 - 2 * pad }
  }
  if (shape.kind === 'frame') {
    const inset = shape.layout === 'table' ? 0 : 14 // a table's caption lines up with its grid
    return { x: shape.x + inset, y: shape.y + 8, w: shape.w - 2 * inset, h: titleBand(shape) - 8 }
  }
  return { x: shape.x + pad, y: shape.y + pad, w: shape.w - 2 * pad, h: shape.h - 2 * pad }
}

/** The text of a shape, wrapped to fit it. */
export function shapeText(shape: Shape): TextBlock {
  const size = fontSizeOf(shape)
  const bold = shape.kind === 'frame'
  const maxWidth = shape.kind === 'arrow' ? SPEC.arrow.maxLine * size : Math.max(size, textArea(shape).w)
  return layoutText(shape.text, size, maxWidth, bold)
}

const up10 = (n: number) => Math.ceil(n / 10) * 10

/** How tall a shape must be to hold a block of text this tall. */
function heightFor(shape: Shape, textHeight: number): number {
  const { pad, minH } = SPEC[shape.kind]
  let h = textHeight + 2 * pad
  if (shape.kind === 'ellipse') h *= Math.SQRT2
  if (shape.kind === 'diamond') h *= 2
  return up10(Math.max(minH, h))
}

/** The size a shape whose size follows its text (`auto: 'size'`) should have. */
export function autoSize(shape: Shape): { w: number; h: number } {
  const spec = SPEC[shape.kind]
  const size = fontSizeOf(shape)
  const block = layoutText(shape.text, size, spec.maxLine * size)
  let w = block.width + 2 * spec.pad
  if (shape.kind === 'box') w += 16 // a little air on the sides reads better
  if (shape.kind === 'ellipse') w *= Math.SQRT2
  if (shape.kind === 'diamond') w *= 2
  if (shape.kind === 'sticky') w = spec.minW
  w = up10(Math.max(spec.minW, w))
  // Wrap at the final width, so the height is exactly what the text needs there.
  return { w, h: heightFor(shape, shapeText({ ...shape, w }).height) }
}

/** The height a shape with a fixed width (`auto: 'height'`) needs for its text. */
export function fitHeight(shape: Shape): number {
  return heightFor(shape, shapeText(shape).height)
}

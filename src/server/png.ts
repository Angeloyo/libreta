// Board → PNG for `libreta look`, using the same SVG renderer the browser uses.

import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Board, Rect } from '../core/model.ts'
import { renderBoard } from '../core/render.ts'
import { FONT_FAMILY } from '../core/text.ts'

const FONTS = ['ShantellSans-Regular.ttf', 'ShantellSans-Bold.ttf'].map((f) => fileURLToPath(new URL(`../../assets/fonts/${f}`, import.meta.url)))
const MAX_SIDE = 1600 // longest edge; keeps text readable and the image around 1–3k tokens

export interface LookOptions {
  bounds?: Rect
  badges?: boolean
  highlight?: Set<string>
}

export function renderPng(board: Board, opts: LookOptions): { png: Buffer; width: number; height: number } {
  const svg = renderBoard(board, opts)
  const [w, h] = (svg.match(/width="(\d+)" height="(\d+)"/) ?? []).slice(1).map(Number)
  const zoom = Math.max(0.4, Math.min(1.5, MAX_SIDE / Math.max(w, h)))
  const image = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: zoom },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
  }).render()
  return { png: image.asPng(), width: image.width, height: image.height }
}

export function writePng(name: string, png: Buffer): string {
  const dir = join(tmpdir(), 'libreta')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name.replace(/[^\w-]+/g, '-')}.png`)
  writeFileSync(file, png)
  return file
}

// The camera maps board coordinates to the screen: screen = (board - origin) * zoom.

import type { Rect } from '../../core/model.ts'

export interface Camera {
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

export function toBoard(cam: Camera, sx: number, sy: number): [number, number] {
  return [cam.x + sx / cam.zoom, cam.y + sy / cam.zoom]
}

export function toScreen(cam: Camera, bx: number, by: number): [number, number] {
  return [(bx - cam.x) * cam.zoom, (by - cam.y) * cam.zoom]
}

/** Zooms by `factor`, keeping the board point under the screen point (sx, sy) still. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor))
  const [bx, by] = toBoard(cam, sx, sy)
  return { zoom, x: bx - sx / zoom, y: by - sy / zoom }
}

/** The camera that shows `bounds` in a screen of size w × h, never zooming in past 100%. */
export function fit(bounds: Rect, w: number, h: number, padding = 60): Camera {
  const zoom = Math.min(1, (w - 2 * padding) / Math.max(bounds.w, 1), (h - 2 * padding) / Math.max(bounds.h, 1))
  const z = Math.max(MIN_ZOOM, zoom)
  return { zoom: z, x: bounds.x + bounds.w / 2 - w / 2 / z, y: bounds.y + bounds.h / 2 - h / 2 / z }
}

export function visibleRect(cam: Camera, w: number, h: number): Rect {
  return { x: cam.x, y: cam.y, w: w / cam.zoom, h: h / cam.zoom }
}

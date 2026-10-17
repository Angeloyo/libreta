import { useEffect, useReducer, useRef, type RefObject } from 'react'
import { union } from '../../core/geometry.ts'
import type { Board } from '../../core/model.ts'
import { edit, getState, reportPresence } from '../store.ts'
import { testing } from '../testing.ts'
import { Editor } from './editor.ts'
import { StylePanel, Toolbar } from './Toolbar.tsx'
import { CanvasView } from './view.ts'

interface Props {
  board: Board
  path: string
  /** Who made the latest change; the agent's new shapes animate in. */
  lastBy?: 'human' | 'agent'
  /** Filled with the canvas and its editor, for the toolbar and buttons outside it. */
  view: RefObject<CanvasView | undefined>
  editor: RefObject<Editor | undefined>
  onZoom?: (zoom: number) => void
}

export function Canvas({ board, path, lastBy, view, editor, onZoom }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const fitted = useRef<string>(undefined)
  const zoomed = useRef(onZoom)
  zoomed.current = onZoom
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    const v = new CanvasView(ref.current!)
    v.onCameraChanged.push(() => {
      reportPresence({ view: v.visible() })
      zoomed.current?.(v.cam.zoom)
    })
    view.current = v
    const ed = new Editor(v, () => getState().board, edit)
    ed.onSelect = (ids) => reportPresence({ selection: ids })
    ed.subscribe(rerender)
    editor.current = ed
    if (import.meta.env.DEV) Object.assign(window, { libreta: { view: v, editor: ed, getState, test: testing } }) // for automated tests
    rerender()
    return () => v.destroy()
  }, [])

  useEffect(() => {
    const v = view.current!
    const first = fitted.current !== path
    const byAgent = !first && lastBy === 'agent'
    const changed = v.setBoard(board, byAgent)
    editor.current?.boardChanged()
    if (first) {
      v.fitToContent()
      fitted.current = path
    } else if (byAgent && changed.length && !editor.current?.busy()) {
      // Follow the agent: if it drew outside the view, glide over to show it.
      v.reveal(union(changed)!)
    }
  }, [board, path, lastBy])

  return (
    <div className="canvas-wrap">
      <div className="canvas" ref={ref} />
      {editor.current && <Toolbar editor={editor.current} />}
      {editor.current && <StylePanel editor={editor.current} />}
    </div>
  )
}

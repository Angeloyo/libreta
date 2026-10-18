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
  /** Showing the past (history): no editing. Stepping forward one rev animates like a replay. */
  readOnly?: boolean
  /** Filled with the canvas and its editor, for the toolbar and buttons outside it. */
  view: RefObject<CanvasView | undefined>
  editor: RefObject<Editor | undefined>
  onZoom?: (zoom: number) => void
}

export function Canvas({ board, path, lastBy, readOnly = false, view, editor, onZoom }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const fitted = useRef<string>(undefined)
  const lastRev = useRef(board.rev)
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
    const replayStep = readOnly && board.rev === lastRev.current + 1
    lastRev.current = board.rev
    const animate = !first && ((lastBy === 'agent' && !readOnly) || replayStep)
    const changed = v.setBoard(board, animate)
    editor.current!.readOnly = readOnly
    editor.current?.boardChanged()
    if (first) {
      v.fitToContent()
      fitted.current = path
    } else if (animate && changed.length && !editor.current?.busy()) {
      // Follow the agent (or the replay): if it drew outside the view, glide over to show it.
      v.reveal(union(changed)!)
    }
  }, [board, path, lastBy, readOnly])

  return (
    <div className="canvas-wrap">
      <div className={`canvas ${readOnly ? 'past' : ''}`} ref={ref} />
      {readOnly ? (
        <div className="past-banner">Looking at rev {board.rev}. This is the past, so editing is off.</div>
      ) : (
        <>
          {editor.current && <Toolbar editor={editor.current} />}
          {editor.current && <StylePanel editor={editor.current} />}
        </>
      )}
    </div>
  )
}

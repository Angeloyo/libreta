import { useEffect, useRef, useState } from 'react'
import { Canvas } from './canvas/Canvas.tsx'
import type { Editor } from './canvas/editor.ts'
import type { CanvasView } from './canvas/view.ts'
import { Sidebar } from './Sidebar.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { connect, fromHash, openBoard, toggleHistory, undoAgent, useStore } from './store.ts'

export function App() {
  const state = useStore()
  const view = useRef<CanvasView>(undefined)
  const editor = useRef<Editor>(undefined)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    connect()
    const onHash = () => openBoard(fromHash(location.hash))
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="app">
      <Sidebar library={state.library} current={state.path} />
      <main>
        <header>
          <span className="title">{state.board?.name ?? 'Libreta'}</span>
          {state.board && <span className="muted">rev {state.board.rev}</span>}
          <span className="spacer" />
          {state.errors.length > 0 && <span className="error">{state.errors[0]}</span>}
          {state.agentRev !== undefined && state.lastBy === 'agent' && (
            <button className="agent" onClick={() => undoAgent(state.agentRev!)} title="Undo Claude's latest change">
              ✦ Claude changed this · Undo
            </button>
          )}
          {state.board && (
            <button className={state.historyOpen ? 'on' : ''} onClick={toggleHistory} title="Who changed what">
              History
            </button>
          )}
          {state.board && (
            <button onClick={() => view.current?.fitToContent()} title="Fit to content (shift+1)">
              {Math.round(zoom * 100)}%
            </button>
          )}
          <span className={state.connected ? 'dot on' : 'dot'} title={state.connected ? 'connected' : 'reconnecting…'} />
        </header>
        <div className="workspace">
          {state.board && state.path ? (
            <Canvas
              board={state.preview?.board ?? state.board}
              path={state.path}
              lastBy={state.lastBy}
              readOnly={!!state.preview}
              view={view}
              editor={editor}
              onZoom={setZoom}
            />
          ) : (
            <div className="empty">{state.path ? 'Loading…' : 'Pick a board on the left, or create one.'}</div>
          )}
          {state.historyOpen && state.board && <HistoryPanel state={state} onHover={(ids) => view.current?.highlight(ids)} />}
        </div>
      </main>
    </div>
  )
}

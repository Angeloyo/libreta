// Who did what, newest first. Hover a change to see what it touched; click it to see the board
// as it was then; drag the slider (or press play) to watch the board being built.

import { useEffect, useRef, useState } from 'react'
import type { HistoryEntry } from '../core/history.ts'
import type { State } from './store.ts'
import { restoreRev, showRev, toggleHistory } from './store.ts'

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(ms).toLocaleDateString()
}

const who = (e: HistoryEntry) => (e.by === 'human' ? 'You' : e.agent ? e.agent[0].toUpperCase() + e.agent.slice(1) : 'Agent')

function counts(e: HistoryEntry): string {
  const { added, edited, removed } = e.counts
  return [added && `+${added}`, edited && `~${edited}`, removed && `−${removed}`].filter(Boolean).join(' ')
}

interface Props {
  state: State
  /** Highlights shapes on the canvas (empty to clear). */
  onHover: (ids: string[]) => void
}

export function HistoryPanel({ state, onHover }: Props) {
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  const history = state.history
  const now = state.board?.rev ?? 0
  const shown = state.preview?.rev ?? now

  // Play: step through every rev from the start (or from where the slider is) to now.
  useEffect(() => {
    if (!playing || !history) return
    let rev = shown >= now ? history.oldest : shown
    showRev(rev)
    timer.current = setInterval(() => {
      rev++
      showRev(rev)
      if (rev >= now) setPlaying(false)
    }, 650)
    return () => clearInterval(timer.current)
  }, [playing])

  if (!history) return <aside className="history">Loading history…</aside>
  const entries = [...history.entries].reverse()

  return (
    <aside className="history">
      <div className="history-head">
        <strong>History</strong>
        <span className="muted">rev {shown}</span>
        <span className="spacer" />
        <button onClick={toggleHistory} title="Close">
          ×
        </button>
      </div>
      <div className="replay">
        <button onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Replay the board being built'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={history.oldest}
          max={now}
          value={shown}
          onChange={(e) => {
            setPlaying(false)
            showRev(Number(e.target.value))
          }}
        />
      </div>
      {state.preview && !playing && (
        <div className="preview-actions">
          <span>Looking at rev {state.preview.rev}</span>
          <button onClick={() => showRev(undefined)}>Back to now</button>
          <button className="primary" onClick={() => restoreRev(state.preview!.rev)}>
            Restore this
          </button>
        </div>
      )}
      <ol>
        {entries.map((e) => (
          <li
            key={e.rev}
            className={`${e.by} ${e.rev === shown ? 'current' : ''}`}
            onMouseEnter={() => onHover(e.ids)}
            onMouseLeave={() => onHover([])}
            onClick={() => showRev(e.rev)}
          >
            <span className="who">{e.by === 'agent' ? '✦' : '●'}</span>
            <div>
              <div className="title">{e.title}</div>
              <div className="meta">
                {who(e)} · {ago(e.at)} {counts(e) && `· ${counts(e)}`} · rev {e.rev}
              </div>
            </div>
          </li>
        ))}
        {history.oldest > 0 && <li className="muted older">Older changes aren't kept (before rev {history.oldest}).</li>}
        {history.oldest === 0 && (
          <li className={`muted older ${shown === 0 ? 'current' : ''}`} onClick={() => showRev(0)}>
            rev 0 · the empty board
          </li>
        )}
      </ol>
    </aside>
  )
}

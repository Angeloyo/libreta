import { COLORS, type Color, type Fill, type Size, type Stroke } from '../../core/model.ts'
import { SHORTCUTS, type Editor, type Tool } from './editor.ts'

const TOOLS: { tool: Tool; icon: string; label: string }[] = [
  { tool: 'select', icon: '↖', label: 'Select' },
  { tool: 'hand', icon: '✋', label: 'Pan' },
  { tool: 'box', icon: '▭', label: 'Box' },
  { tool: 'ellipse', icon: '◯', label: 'Ellipse' },
  { tool: 'diamond', icon: '◇', label: 'Diamond' },
  { tool: 'arrow', icon: '→', label: 'Arrow' },
  { tool: 'text', icon: 'T', label: 'Text' },
  { tool: 'sticky', icon: '▤', label: 'Sticky note' },
  { tool: 'frame', icon: '⌗', label: 'Frame' },
  { tool: 'pen', icon: '✎', label: 'Pen' },
]
const KEY = Object.fromEntries(Object.entries(SHORTCUTS).map(([k, t]) => [t, k]))

export function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="toolbar">
      {TOOLS.map(({ tool, icon, label }) => (
        <button key={tool} className={editor.tool === tool ? 'active' : ''} title={`${label} (${KEY[tool]})`} onClick={() => editor.setTool(tool)}>
          {icon}
        </button>
      ))}
    </div>
  )
}

const FILLS: Fill[] = ['none', 'light', 'solid']
const STROKES: Stroke[] = ['solid', 'dashed', 'dotted']
const SIZES: Size[] = ['s', 'm', 'l', 'xl']

/** Color, fill, stroke and size for the selected shapes. */
export function StylePanel({ editor }: { editor: Editor }) {
  const shapes = editor.selectedShapes()
  if (!shapes.length) return null
  const first = shapes[0]
  return (
    <div className="style-panel">
      <div className="row">
        {(Object.keys(COLORS) as Color[]).map((c) => (
          <button key={c} title={c} className={`swatch ${first.color === c ? 'active' : ''}`} style={{ background: COLORS[c].stroke }} onClick={() => editor.style({ color: c })} />
        ))}
      </div>
      <div className="row">
        {FILLS.map((f) => (
          <button key={f} className={first.fill === f ? 'active' : ''} onClick={() => editor.style({ fill: f })}>
            {f}
          </button>
        ))}
      </div>
      <div className="row">
        {STROKES.map((s) => (
          <button key={s} className={first.stroke === s ? 'active' : ''} onClick={() => editor.style({ stroke: s })}>
            {s}
          </button>
        ))}
      </div>
      <div className="row">
        {SIZES.map((s) => (
          <button key={s} className={first.size === s ? 'active' : ''} onClick={() => editor.style({ size: s })}>
            {s.toUpperCase()}
          </button>
        ))}
        <span className="spacer" />
        <button title="Delete (⌫)" onClick={() => editor.deleteSelection()}>
          🗑
        </button>
      </div>
    </div>
  )
}

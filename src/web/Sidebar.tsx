// The board library: folders and boards as they are on disk. Create, rename (double-click),
// drag boards into folders, and delete (to the trash).

import { useState, type DragEvent, type KeyboardEvent } from 'react'
import type { Entry } from '../server/library.ts'
import { libraryAction, toHash } from './store.ts'

type Naming = { kind: 'board' | 'folder'; parent: string } | { kind: 'rename'; entry: Entry }

const COLLAPSED_KEY = 'libreta.collapsed'
function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function Sidebar({ library, current }: { library: Entry[]; current?: string }) {
  const [naming, setNaming] = useState<Naming>()
  const [confirming, setConfirming] = useState<string>()
  const [error, setError] = useState<string>()
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [dropTarget, setDropTarget] = useState<string>()

  const run = async (action: string, body: { path?: string; to?: string }) => {
    try {
      setError(undefined)
      return await libraryAction(action, body)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const toggle = (path: string) => {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
    } catch {
      // Private window: collapsing just won't be remembered.
    }
  }

  const submitName = async (value: string) => {
    const n = naming
    setNaming(undefined)
    if (!n || !value.trim()) return
    if (n.kind === 'rename') {
      const parent = n.entry.path.split('/').slice(0, -1).join('/')
      const to = parent ? `${parent}/${value.trim()}` : value.trim()
      const text = await run('mv', { path: n.entry.path, to })
      if (text && n.entry.path === current) location.hash = toHash(to)
      return
    }
    const path = n.parent ? `${n.parent}/${value.trim()}` : value.trim()
    const text = await run(n.kind === 'board' ? 'new' : 'mkdir', { path })
    if (text && n.kind === 'board') location.hash = toHash(path)
  }

  const drop = async (e: DragEvent, folder: string) => {
    e.preventDefault()
    setDropTarget(undefined)
    const path = e.dataTransfer.getData('text/libreta-path')
    if (!path || path === folder || folder.startsWith(path + '/')) return
    const name = path.split('/').pop()!
    if ((path.split('/').slice(0, -1).join('/') || '') === folder) return
    await run('mv', { path, to: folder ? `${folder}/${name}` : name })
  }

  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(folder)
    },
    onDragLeave: () => setDropTarget(undefined),
    onDrop: (e: DragEvent) => {
      e.stopPropagation()
      drop(e, folder)
    },
  })

  const nameInput = (initial: string) => (
    <input
      className="name-input"
      autoFocus
      defaultValue={initial}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => submitName(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setNaming(undefined)
      }}
    />
  )

  const tree = (entries: Entry[], parent: string) => (
    <ul>
      {naming && naming.kind !== 'rename' && naming.parent === parent && <li>{nameInput(naming.kind === 'board' ? 'Untitled' : 'New folder')}</li>}
      {entries.map((e) => {
        const renaming = naming?.kind === 'rename' && naming.entry.path === e.path
        const actions = (
          <span className="actions">
            {e.type === 'folder' && (
              <button title="New board in this folder" onClick={() => setNaming({ kind: 'board', parent: e.path })}>
                +
              </button>
            )}
            <button title="Delete" onClick={() => setConfirming(e.path)}>
              ×
            </button>
          </span>
        )
        const confirm = confirming === e.path && (
          <div className="confirm">
            Move “{e.name}” to the trash?{' '}
            <button
              onClick={async () => {
                setConfirming(undefined)
                await run('rm', { path: e.path })
              }}
            >
              Delete
            </button>{' '}
            <button onClick={() => setConfirming(undefined)}>Cancel</button>
          </div>
        )
        if (e.type === 'folder') {
          const open = !collapsed.has(e.path)
          return (
            <li key={e.path} {...dropProps(e.path)} className={dropTarget === e.path ? 'drop' : ''}>
              <div className="row folder" onDoubleClick={() => setNaming({ kind: 'rename', entry: e })}>
                {renaming ? (
                  nameInput(e.name)
                ) : (
                  <span className="name" onClick={() => toggle(e.path)}>
                    {open ? '▾' : '▸'} {e.name}
                  </span>
                )}
                {actions}
              </div>
              {confirm}
              {open && tree(e.children ?? [], e.path)}
            </li>
          )
        }
        return (
          <li key={e.path}>
            <div
              className={`row board ${e.path === current ? 'active' : ''}`}
              draggable={!renaming}
              onDragStart={(ev) => ev.dataTransfer.setData('text/libreta-path', e.path)}
              onDoubleClick={() => setNaming({ kind: 'rename', entry: e })}
            >
              {renaming ? (
                nameInput(e.name)
              ) : (
                <a className="name" href={toHash(e.path)}>
                  {e.name}
                </a>
              )}
              {actions}
            </div>
            {confirm}
          </li>
        )
      })}
    </ul>
  )

  return (
    <nav className={`sidebar ${dropTarget === '' ? 'drop' : ''}`} {...dropProps('')}>
      <div className="brand">Libreta</div>
      <div className="buttons">
        <button onClick={() => setNaming({ kind: 'board', parent: '' })}>+ Board</button>
        <button onClick={() => setNaming({ kind: 'folder', parent: '' })}>+ Folder</button>
      </div>
      {error && <div className="sidebar-error">{error}</div>}
      {tree(library, '')}
      {!library.length && !naming && <p className="muted hint">No boards yet. Create one, or ask Claude to draw something.</p>}
    </nav>
  )
}

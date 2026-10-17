// The board library is a plain folder tree: ~/Libreta/Work/Checkout flow.board.json.
// Finder, git and grep all work on it. Deleted things go to ~/Libreta/.trash.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { emptyBoard, type Board } from '../core/model.ts'
import { UserError } from './errors.ts'

export const HOME = process.env.LIBRETA_HOME ?? join(homedir(), 'Libreta')
const EXT = '.board.json'

export interface Entry {
  type: 'folder' | 'board'
  /** Path inside the library, without the extension: "Work/Checkout flow". */
  path: string
  name: string
  updated: number
  children?: Entry[]
}

/** Rejects paths that would escape the library or are otherwise unusable. */
export function cleanPath(path: string): string {
  const clean = path.replace(/\.board\.json$/, '').replace(/^\/+|\/+$/g, '').trim()
  if (!clean) throw new UserError('empty path')
  if (clean.split('/').some((part) => !part.trim() || part === '..' || part === '.' || part.startsWith('.'))) {
    throw new UserError(`"${path}" isn't a valid name — use names like "Work/Checkout flow"`)
  }
  return clean
}

const fileOf = (path: string) => join(HOME, path + EXT)

export function tree(dir = HOME): Entry[] {
  if (!existsSync(dir)) return []
  const entries: Entry[] = []
  for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const stat = statSync(full)
    const path = relative(HOME, full)
    if (stat.isDirectory()) entries.push({ type: 'folder', path, name, updated: stat.mtimeMs, children: tree(full) })
    else if (name.endsWith(EXT)) entries.push({ type: 'board', path: path.slice(0, -EXT.length), name: name.slice(0, -EXT.length), updated: stat.mtimeMs })
  }
  return entries.sort((a, b) => (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1))
}

export function allBoards(entries = tree()): Entry[] {
  return entries.flatMap((e) => (e.type === 'board' ? [e] : allBoards(e.children)))
}

/** Finds a board from a loose reference: its path, its name, or a unique part of either. */
export function findBoard(ref: string): string {
  const boards = allBoards().map((b) => b.path)
  const want = ref.replace(/\.board\.json$/, '').toLowerCase()
  const exact = boards.find((p) => p.toLowerCase() === want) ?? boards.find((p) => p.split('/').pop()!.toLowerCase() === want)
  if (exact) return exact
  const partial = boards.filter((p) => p.toLowerCase().includes(want))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) throw new UserError(`"${ref}" matches several boards: ${partial.join(', ')} — use the full path`)
  throw new UserError(`no board "${ref}"${boards.length ? ` — boards: ${boards.join(', ')}` : ' — the library is empty; create one with: libreta new "Name"'}`)
}

export function loadBoard(path: string): Board {
  const board = JSON.parse(readFileSync(fileOf(path), 'utf8')) as Board
  board.log ??= []
  // Early boards stored `auto` as a boolean.
  for (const s of board.shapes as { auto?: unknown }[]) if (typeof s.auto === 'boolean') s.auto = s.auto ? 'size' : undefined
  return board
}

/** Writes atomically (temp file + rename) so a crash never leaves half a board. */
export function saveBoard(path: string, board: Board): void {
  const file = fileOf(path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(board))
  renameSync(file + '.tmp', file)
}

export function createBoard(ref: string): string {
  const path = cleanPath(ref)
  if (existsSync(fileOf(path))) throw new UserError(`"${path}" already exists`)
  saveBoard(path, emptyBoard(path.split('/').pop()!))
  return path
}

export function createFolder(ref: string): string {
  const path = cleanPath(ref)
  mkdirSync(join(HOME, path), { recursive: true })
  return path
}

const isFolder = (path: string) => existsSync(join(HOME, path)) && statSync(join(HOME, path)).isDirectory()

/** Renames or moves a board or folder. Moving into an existing folder keeps the name. */
export function moveEntry(fromRef: string, toRef: string): { from: string; to: string; type: 'board' | 'folder' } {
  const from = isFolder(cleanPath(fromRef)) ? cleanPath(fromRef) : findBoard(fromRef)
  const type = isFolder(from) ? 'folder' : 'board'
  let to = cleanPath(toRef)
  if (isFolder(to) && type === 'board') to = join(to, from.split('/').pop()!)
  const [src, dst] = type === 'folder' ? [join(HOME, from), join(HOME, to)] : [fileOf(from), fileOf(to)]
  if (existsSync(dst)) throw new UserError(`"${to}" already exists`)
  mkdirSync(dirname(dst), { recursive: true })
  renameSync(src, dst)
  if (type === 'board') {
    const board = loadBoard(to)
    board.name = to.split('/').pop()!
    saveBoard(to, board)
  }
  return { from, to, type }
}

/** Moves a board or folder to ~/Libreta/.trash instead of deleting it. */
export function trashEntry(ref: string): { path: string; type: 'board' | 'folder' } {
  const path = isFolder(cleanPath(ref)) ? cleanPath(ref) : findBoard(ref)
  const type = isFolder(path) ? 'folder' : 'board'
  const trash = join(HOME, '.trash', `${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(trash, { recursive: true })
  renameSync(type === 'folder' ? join(HOME, path) : fileOf(path), join(trash, path.split('/').pop()! + (type === 'board' ? EXT : '')))
  return { path, type }
}

export function treeText(entries = tree(), indent = ''): string[] {
  return entries.flatMap((e) =>
    e.type === 'folder' ? [`${indent}${e.name}/`, ...treeText(e.children, indent + '  ')] : [`${indent}${e.name}`],
  )
}

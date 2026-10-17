// The line format the agent writes. It mirrors what `libreta read` prints, so a line copied
// from the read view is a valid create:
//
//   frame backend "Backend" layout=col
//   box cache "Redis" in=backend after=api blue
//   connect api -> cache "reads" dashed        (or just: api -> cache "reads")
//   update db text="Aurora" color=green
//   update backend fit                  (a frame shrinks to hug its contents)
//   move web right-of=backend
//   delete q1
//
//   table urls "URLs" green          a table: a frame whose rows follow as markdown
//   | code  | long url        |      the first row is the header
//   | aZ3x9 | https://example |      cells get ids urls-r2c1, urls-r2c2, ...

import { parseOps, type Op } from './ops.ts'
import { didYouMean } from './suggest.ts'

const KINDS = ['box', 'ellipse', 'diamond', 'text', 'sticky', 'frame']
const COLORS = ['black', 'grey', 'blue', 'violet', 'green', 'yellow', 'orange', 'red', 'pink']
const STROKES = ['solid', 'dashed', 'dotted']
const LINKS: Record<string, string> = { '->': 'end', '<->': 'both', '--': 'none' }
const KEYS = [
  'in', 'after', 'before', 'right-of', 'left-of', 'above', 'below', 'near', 'gap', 'align', 'at', 'by',
  'w', 'h', 'text', 'color', 'fill', 'stroke', 'size', 'layout', 'spacing', 'cols', 'heads', 'from', 'to',
]
const IGNORED = ['pinned', 'by=human', 'by=agent'] // annotations the read view prints

const TOKEN = /"(?:[^"\\]|\\.)*"|\([^)]*\)|[^\s=]+=(?:"(?:[^"\\]|\\.)*"|\([^)]*\)|\S+)|\S+/g

function value(raw: string): unknown {
  if (raw.startsWith('"')) return JSON.parse(raw)
  const nums = raw.replace(/[()]/g, '').split(',')
  if (nums.length === 2 && nums.every((n) => n.trim() !== '' && !isNaN(Number(n)))) return nums.map(Number)
  if (raw !== '' && !isNaN(Number(raw))) return Number(raw)
  return raw
}

/** `(x,y wxh)` or `(x,y)` as printed by the read view. */
function geometry(token: string): Record<string, number> | undefined {
  const m = token.match(/^\((-?[\d.]+),\s*(-?[\d.]+)(?:\s+([\d.]+)x([\d.]+))?\)$/)
  if (!m) return undefined
  const out: Record<string, number> = { x: Number(m[1]), y: Number(m[2]) }
  if (m[3]) Object.assign(out, { w: Number(m[3]), h: Number(m[4]) })
  return out
}

/** Parses the line format into ops. Errors name the line they're on; `lines[i]` is op i's line. */
export function parseDsl(source: string): { ops: Op[]; errors: string[]; lines: number[] } {
  const raw: Record<string, unknown>[] = []
  const lineOf: number[] = []
  const errors: string[] = []

  let table: { op: Record<string, unknown>; row: number } | undefined
  source.split('\n').forEach((text, i) => {
    const line = text.trim()
    if (!line || line.startsWith('#')) return
    const where = `line ${i + 1}`
    try {
      const ops = line.startsWith('|') ? tableRow(table, line) : parseLine(line.match(TOKEN) ?? [])
      if (!line.startsWith('|')) table = ops[0]?.layout === 'table' ? { op: ops[0], row: 0 } : undefined
      for (const op of ops) {
        raw.push(op)
        lineOf.push(i + 1)
      }
    } catch (e) {
      errors.push(`${where}: ${(e as Error).message}`)
    }
  })
  const parsed = parseOps(raw, (i) => `line ${lineOf[i]}`)
  return { ops: parsed.ops, errors: [...errors, ...parsed.errors], lines: lineOf }
}

/** A markdown row (`| a | b |`) of the table started on an earlier line: one box per cell. */
function tableRow(table: { op: Record<string, unknown>; row: number } | undefined, line: string): Record<string, unknown>[] {
  if (!table) throw new Error('a "|" row must follow a table line, e.g. table urls "URLs"')
  const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/\\n/g, '\n'))
  if (cells.every((c) => /^:?-+:?$/.test(c))) return [] // a markdown separator row
  const id = table.op.id as string
  table.op.cols ??= cells.length
  if (cells.length > (table.op.cols as number)) throw new Error(`this row has ${cells.length} cells but table ${id} has ${table.op.cols} columns`)
  while (cells.length < (table.op.cols as number)) cells.push('')
  const row = ++table.row
  return cells.map((text, j) => ({
    op: 'create',
    kind: 'box',
    id: `${id}-r${row}c${j + 1}`,
    text,
    in: id,
    ...(row === 1 ? { fill: 'light', color: table.op.color ?? 'grey' } : {}),
  }))
}

function parseLine(tokens: string[]): Record<string, unknown>[] {
  const [head, ...rest] = tokens
  if (head === 'delete') return rest.map((id) => ({ op: 'delete', id }))
  if (head === 'table') {
    const [frame] = parseLine(['frame', ...rest])
    if (!frame.id) throw new Error('a table needs an id (its cells are named after it): table urls "URLs"')
    return [{ ...frame, layout: 'table' }]
  }

  const op: Record<string, unknown> = {}
  let args = rest
  if (KINDS.includes(head)) Object.assign(op, { op: 'create', kind: head })
  else if (head === 'update' || head === 'move') {
    if (!rest[0]) throw new Error(`${head} needs a shape id`)
    Object.assign(op, { op: head, id: rest[0] })
    args = rest.slice(1)
  } else if (head === 'connect' || LINKS[tokens[1]]) {
    // connect [id] a -> b   or the shorthand   a -> b
    args = head === 'connect' ? rest : tokens
    if (args[2] && LINKS[args[2]] && !LINKS[args[1]]) {
      op.id = args[0]
      args = args.slice(1)
    }
    const [from, link, to] = args
    if (!from || !LINKS[link] || !to) throw new Error(`connect needs: connect <from> -> <to>`)
    Object.assign(op, { op: 'connect', from: value(from), to: value(to) })
    if (link !== '->') op.heads = LINKS[link]
    args = args.slice(3)
  } else {
    throw new Error(`unknown command "${head}" — start a line with a shape kind (${KINDS.join(', ')}), table, connect, update, move or delete${didYouMean(head, [...KINDS, 'table', 'connect', 'update', 'move', 'delete'])}`)
  }

  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (IGNORED.includes(token)) continue
    if (token.startsWith('"')) {
      op.text = JSON.parse(token)
      continue
    }
    const geo = geometry(token)
    if (geo) {
      op.at = [geo.x, geo.y]
      if (geo.w !== undefined) Object.assign(op, { w: geo.w, h: geo.h })
      continue
    }
    if (token === 'fit' && op.op === 'update') op.fit = true
    else if (COLORS.includes(token)) op.color = token
    else if (STROKES.includes(token)) op.stroke = token
    else if (token === 'in' && args[i + 1]) op.in = args[++i] === 'none' ? null : args[i]
    else if (token.includes('=')) {
      const at = token.indexOf('=')
      const key = token.slice(0, at)
      const val = token.slice(at + 1)
      if (!KEYS.includes(key)) throw new Error(`unknown key "${key}"${didYouMean(key, KEYS)}`)
      op[key.replace('-', '_')] = key === 'in' && val === 'none' ? null : value(val)
    } else if (op.op === 'create' && op.id === undefined && op.text === undefined && /^[A-Za-z][\w-]*$/.test(token)) {
      op.id = token
    } else {
      throw new Error(`don't know what "${token}" means here`)
    }
  }
  // Values like text=42 or in=7 arrive as numbers; ids and text are always strings.
  for (const key of ['text', 'in', 'after', 'before', 'right_of', 'left_of', 'above', 'below', 'near']) {
    if (typeof op[key] === 'number') op[key] = String(op[key])
  }
  return [op]
}

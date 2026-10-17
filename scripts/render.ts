// Dev tool: draw line-format ops on an empty board, print what the agent would read, save a PNG.
//   node scripts/render.ts <ops-file> <out.png> [--diagram]
import { readFileSync, writeFileSync } from 'node:fs'
import { apply } from '../src/core/apply.ts'
import { layoutDiagram } from '../src/core/diagram.ts'
import { parseDsl } from '../src/core/dsl.ts'
import { lint } from '../src/core/lint.ts'
import { emptyBoard } from '../src/core/model.ts'
import { readView } from '../src/core/view.ts'
import { renderPng } from '../src/server/png.ts'

const [file, out, flag] = process.argv.slice(2)
const parsed = parseDsl(readFileSync(file, 'utf8'))
if (parsed.errors.length) throw new Error(parsed.errors.join('\n'))
const board = emptyBoard('Render')
const ops = flag === '--diagram' ? (await layoutDiagram(board, parsed.ops, { frame: { id: 'd', title: 'Diagram' } })).ops : parsed.ops
const result = apply(board, ops, { by: 'agent' })
if (!result.ok) throw new Error(result.errors.join('\n'))
console.log(readView(result.board, { problems: lint(result.board) }))
writeFileSync(out, renderPng(result.board, { badges: true }).png)

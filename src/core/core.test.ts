import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, type ApplyContext } from './apply.ts'
import { routeArrow } from './arrows.ts'
import { layoutDiagram } from './diagram.ts'
import { parseDsl } from './dsl.ts'
import { lint } from './lint.ts'
import { emptyBoard, getShape, type Board } from './model.ts'
import { restore, revert, shapesAt } from './history.ts'
import { humanChangesSince, readView } from './view.ts'

/** Applies line-format source, failing the test on any error. */
function run(board: Board, source: string, ctx: Partial<ApplyContext> = {}): Board {
  const { ops, errors } = parseDsl(source)
  assert.deepEqual(errors, [])
  const result = apply(board, ops, { by: 'agent', ...ctx })
  assert.deepEqual(result.errors, [])
  return result.board
}

function shape(board: Board, id: string) {
  const s = getShape(board, id)
  assert.ok(s, `missing shape ${id}`)
  return s
}

test('dsl: shapes, arrows, updates and read-view lines', () => {
  const { ops, errors } = parseDsl(`
    # a comment
    box api "API Gateway" blue in=backend
    api -> db "writes" dashed
    connect a9 web <-> api
    update db text="Aurora" color=green
    box web "Web app" (120,260 200x80) grey pinned by=human
    delete q1 q2
  `)
  assert.deepEqual(errors, [])
  assert.deepEqual(ops[0], { op: 'create', kind: 'box', id: 'api', text: 'API Gateway', color: 'blue', in: 'backend' })
  assert.deepEqual(ops[1], { op: 'connect', from: 'api', to: 'db', text: 'writes', stroke: 'dashed' })
  assert.deepEqual(ops[2], { op: 'connect', id: 'a9', from: 'web', to: 'api', heads: 'both' })
  assert.deepEqual(ops[3], { op: 'update', id: 'db', text: 'Aurora', color: 'green' })
  assert.deepEqual(ops[4], { op: 'create', kind: 'box', id: 'web', text: 'Web app', at: [120, 260], w: 200, h: 80, color: 'grey' })
  assert.equal(ops.length, 7)
})

test('dsl: errors name the line and suggest fixes', () => {
  const { errors } = parseDsl('box a "A"\nbox b "B" rigth-of=a\nbxo c')
  assert.match(errors[0], /line 2: unknown key "rigth-of" — did you mean "right-of"\?/)
  assert.match(errors[1], /line 3: unknown command "bxo".*did you mean "box"/)
})

test('apply: unknown ids fail the whole batch with a suggestion', () => {
  const board = run(emptyBoard('t'), 'box cache "Redis"')
  const { ops } = parseDsl('box x "X"\nconnect cahce -> x')
  const result = apply(board, ops, { by: 'agent', where: (i) => `line ${i + 1}` })
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /line 2 \(connect\): no shape "cahce" — did you mean "cache"\?/)
  assert.equal(result.board, board, 'nothing applied')
})

test('apply: shapes without positions never overlap', () => {
  const board = run(emptyBoard('t'), `
    box a "Alpha"
    box b "Beta"
    ellipse c "Gamma"
    diamond d "Decide?"
    sticky e "A note"
    text f "Some free text"
  `)
  assert.deepEqual(lint(board), [])
})

test('apply: a column frame restacks when a child is inserted', () => {
  let board = run(emptyBoard('t'), 'frame f "Stack" layout=col\nbox a "A" in=f\nbox c "C" in=f')
  const cBefore = shape(board, 'c').y
  board = run(board, 'box b "B" in=f after=a')
  assert.ok(shape(board, 'b').y > shape(board, 'a').y)
  assert.ok(shape(board, 'c').y > cBefore, 'c moved down to make room')
  const f = shape(board, 'f')
  assert.ok(shape(board, 'c').y + shape(board, 'c').h <= f.y + f.h, 'frame grew to hold it')
})

test('apply: relative placement keeps clear of other shapes', () => {
  const board = run(emptyBoard('t'), 'box a "A" (0,0 120x60)\nbox blocker "B" (160,0 120x60)\nbox c "C" right-of=a')
  assert.ok(shape(board, 'c').x >= 280, 'slid past the blocker')
  assert.deepEqual(lint(board), [])
})

test('apply: layout frames reject explicit positions with a hint', () => {
  const board = run(emptyBoard('t'), 'frame f "F" layout=col\nbox a "A" in=f')
  const { ops } = parseDsl('box b "B" in=f right-of=a')
  const result = apply(board, ops, { by: 'agent' })
  assert.match(result.errors[0], /arranges its children \(layout=col\); use after\/before/)
})

test('apply: deleting a shape removes its arrows and says so', () => {
  let board = run(emptyBoard('t'), 'box a "A"\nbox b "B"\na -> b')
  const { ops } = parseDsl('delete b')
  const result = apply(board, ops, { by: 'agent' })
  board = result.board
  assert.equal(getShape(board, 'a1'), undefined)
  assert.match(result.notes[0], /also removed arrow a1/)
})

test('apply: the agent does not overwrite what the human changed since it last looked', () => {
  let board = run(emptyBoard('t'), 'box db "Postgres"')
  const seen = board.rev
  board = run(board, 'update db text="Aurora"', { by: 'human' })
  const { ops } = parseDsl('update db text="MySQL" color=blue')
  const result = apply(board, ops, { by: 'agent', baseRev: seen })
  assert.equal(shape(result.board, 'db').text, 'Aurora')
  assert.equal(shape(result.board, 'db').color, 'blue', 'other fields still apply')
  assert.match(result.notes[0], /skipped db\.text/)
})

test('apply: a human move pins the shape', () => {
  let board = run(emptyBoard('t'), 'box a "A"')
  board = run(board, 'move a at=(500,500)', { by: 'human' })
  assert.equal(shape(board, 'a').pinned, true)
})

test('arrows: route around a shape in the way', () => {
  const board = run(emptyBoard('t'), 'box a "A" (0,0 120x60)\nbox mid "M" (200,0 120x60)\nbox b "B" (400,0 120x60)\na -> b')
  const route = routeArrow(board, shape(board, 'a1'))
  assert.ok(route.points.length > 2, 'bent around mid')
  assert.deepEqual(lint(board), [])
})

test('view: read view and human change summaries', () => {
  let board = run(emptyBoard('Demo'), 'frame f "Group" layout=row\nbox a "A" in=f blue\nbox b "B" in=f\na -> b "calls"')
  const seen = board.rev
  board = run(board, 'update a text="Alpha"\nsticky n "hm?" (600,0)', { by: 'human' })
  const view = readView(board, { humanSince: { rev: seen, lines: humanChangesSince(board, seen) } })
  assert.match(view, /^board "Demo" rev=2 · 4 shapes, 1 arrow/)
  assert.match(view, /\n {2}box a "Alpha" \(\d+,\d+ \d+x\d+\) blue/)
  assert.match(view, /a1 a -> b "calls"/)
  assert.match(view, /human since rev 1:\n- a text "A" → "Alpha"\n- \+ sticky n "hm\?" .* · right of b, outside frame f/)
})

test('view: a long text that only grew shows what was added', () => {
  let board = run(emptyBoard('t'), 'sticky q "Should we let anyone with a Google account in?"')
  board = run(board, 'update q text="Should we let anyone with a Google account in? -> YES"', { by: 'human' })
  assert.match(humanChangesSince(board, 1)[0], /^q text: appended " -> YES"$/)
})

test('ink: a zig-zag over a shape crosses it out; a closed loop circles it', () => {
  let board = run(emptyBoard('t'), 'box a "A" (0,0 200x100)\nbox b "B" (400,0 200x100)')
  const zigzag = Array.from({ length: 9 }, (_, i) => [20 + i * 20, i % 2 ? 80 : 20])
  const loop = Array.from({ length: 19 }, (_, i) => [500 + 130 * Math.cos((i * Math.PI) / 9), 50 + 80 * Math.sin((i * Math.PI) / 9)])
  board = apply(board, [{ op: 'create', kind: 'pen', id: 'p1', points: zigzag }, { op: 'create', kind: 'pen', id: 'p2', points: loop }], { by: 'human' }).board
  const view = readView(board)
  assert.match(view, /pen p1 .* crosses out a/)
  assert.match(view, /pen p2 .* circles b/)
})

test('revert: undo puts a change back, undoing the undo redoes it', () => {
  const before = run(emptyBoard('t'), 'frame f "F" layout=col\nbox a "A" in=f\nbox c "C" in=f')
  const after = run(before, 'box b "B" in=f after=a\nupdate a text="Alpha" color=blue\ndelete c')
  const undone = revert(after, after.log.at(-1)!, 'human')
  assert.deepEqual(undone.board.shapes.map((s) => [s.id, s.text, s.color, s.y]).sort(), before.shapes.map((s) => [s.id, s.text, s.color, s.y]).sort())
  const redone = revert(undone.board, undone.changeset!, 'human')
  assert.deepEqual(redone.board.shapes.map((s) => [s.id, s.text, s.y]).sort(), after.shapes.map((s) => [s.id, s.text, s.y]).sort())
})

test('revert: a human move that pinned a shape is fully undone', () => {
  let board = run(emptyBoard('t'), 'box a "A"')
  board = run(board, 'move a at=(500,500)', { by: 'human' })
  const undone = revert(board, board.log.at(-1)!, 'human').board
  assert.equal(shape(undone, 'a').pinned, undefined)
})

test('tables: markdown rows become cells; columns fit their widest cell', () => {
  const board = run(emptyBoard('t'), 'table t "People" green\n| name | role |\n|---|---|\n| Ada | engineer |\n| Grace | admiral of the fleet |')
  const t = shape(board, 't')
  assert.equal(t.layout, 'table')
  assert.equal(t.cols, 2)
  assert.equal(shape(board, 't-r1c1').fill, 'light')
  assert.equal(shape(board, 't-r2c1').w, shape(board, 't-r3c1').w, 'a column shares one width')
  assert.equal(shape(board, 't-r3c1').x + shape(board, 't-r3c1').w, shape(board, 't-r3c2').x, 'cells touch')
  assert.match(readView(board), /\| Grace \| admiral of the fleet \|\n {2}cells: t-r<row>c<col>/)
})

test('placement: right-of a table that only gets its final size at the end of the batch', () => {
  const board = run(emptyBoard('t'), `
    table a "A"
    | x | a very long cell that makes this table much wider than a new frame starts out |
    frame b "B" right-of=a
    box z "Z" in=b
  `)
  assert.ok(shape(board, 'b').x >= shape(board, 'a').x + shape(board, 'a').w, 'b is right of the final table')
  assert.deepEqual(lint(board), [])
})

test('sizing: w alone fits the height to the text; h alone keeps the width', () => {
  let board = run(emptyBoard('t'), 'text n "a fairly long note that will need to wrap over several lines" w=150')
  const n = shape(board, 'n')
  assert.equal(n.w, 150)
  assert.ok(n.h >= 3 * 26, 'grew tall enough')
  assert.deepEqual(lint(board), [])
  board = run(board, 'update n text="short"')
  assert.ok(shape(board, 'n').h < n.h, 'shrinks back when the text gets shorter')
  board = run(board, 'update n h=200')
  assert.equal(shape(board, 'n').w, 150)
})

test('lint: characters the font cannot draw are reported', () => {
  const board = run(emptyBoard('t'), 'box a "step ① then ②"')
  assert.match(lint(board)[0].message, /can't draw \(① ②\)/)
})

test('diagram: re-running revises in place and keeps the human\'s arrows and shapes', async () => {
  const spec = (extra = '') => parseDsl(`box a "A"\nbox b "B"\nbox c "C"\na -> b\nb -> c${extra}`).ops
  let board = apply(emptyBoard('t'), (await layoutDiagram(emptyBoard('t'), spec(), { frame: { id: 'd', title: 'D' } })).ops, { by: 'agent' }).board
  board = run(board, 'sticky q "why B?" (900,0)\nq -> b', { by: 'human' })
  const second = await layoutDiagram(board, parseDsl('box a "A"\nbox b "B, revised"\nbox e "E"\na -> b\nb -> e').ops, { frame: { id: 'd', title: 'D v2' } })
  const result = apply(board, second.ops, { by: 'agent' })
  assert.deepEqual(result.errors, [])
  board = result.board
  assert.equal(shape(board, 'b').text, 'B, revised')
  assert.equal(getShape(board, 'c'), undefined, 'c was dropped from the spec')
  assert.ok(board.shapes.some((s) => s.kind === 'arrow' && s.by === 'human' && 'id' in s.to! && s.to.id === 'b'), "the human's arrow to b survives")
  assert.ok(getShape(board, 'q'), "the human's sticky survives")
  assert.equal(shape(board, 'd').text, 'D v2')
})

test('frames: fit shrinks a frame to hug its children', () => {
  let board = run(emptyBoard('t'), 'frame f "F" w=900 h=700\nbox a "A" in=f at=(100,120)')
  board = run(board, 'update f fit')
  const f = shape(board, 'f')
  assert.ok(f.w < 300 && f.h < 300, `got ${f.w}x${f.h}`)
  assert.deepEqual(lint(board), [])
})

test('view: removed and then restored (undo) is no change at all', () => {
  let board = run(emptyBoard('t'), 'box a "A"')
  const seen = board.rev
  board = run(board, 'delete a', { by: 'human' })
  board = revert(board, board.log.at(-1)!, 'human').board
  assert.deepEqual(humanChangesSince(board, seen), [])
})

test('placement: a frame below another stays put when a later shape is placed beside it', () => {
  const rows = Array.from({ length: 10 }, (_, i) => `| k${i} | some tool ${i} |`).join('\n')
  const stickies = Array.from({ length: 6 }, (_, i) => `sticky t${i} "note ${i}" in=try`).join('\n')
  const board = run(emptyBoard('t'), `frame how "How" (100,100 800x300)\nframe try "Try" layout=grid cols=3 below=how align=start gap=60\n${stickies}\ntable keys "Keys" right-of=try align=start gap=60\n| key | tool |\n${rows}`)
  assert.equal(shape(board, 'try').y, 100 + 300 + 60)
  assert.equal(shape(board, 'keys').y, shape(board, 'try').y)
  assert.deepEqual(lint(board), [])
})

test('arrows: two arrows between the same shapes keep their labels apart', () => {
  const board = run(emptyBoard('t'), 'box a "A" (0,0 160x80)\nbox b "B" (600,0 160x80)\na -> b "what you changed"\nb -> a "read, apply, diagram"')
  assert.deepEqual(lint(board), [])
})

test('sizing: longer text in a fixed-size box makes it taller, never cut off', () => {
  let board = run(emptyBoard('t'), 'box b "Box" (0,0 160x80)')
  board = run(board, 'update b text="Box, renamed to something much longer"', { by: 'human' })
  assert.equal(shape(board, 'b').w, 160)
  assert.ok(shape(board, 'b').h > 80)
  assert.deepEqual(lint(board), [])
})

test('history: the board at an earlier rev, and restoring it as a new change', () => {
  let board = run(emptyBoard('t'), 'box a "A"', { agent: 'claude' })
  board = run(board, 'box b "B"\na -> b', { agent: 'claude' })
  board = run(board, 'update a text="Alpha"\ndelete b', { by: 'human' })
  assert.deepEqual(shapesAt(board, 1)!.map((s) => s.id), ['a'])
  assert.deepEqual(shapesAt(board, 2)!.map((s) => [s.id, s.text]), [['a', 'A'], ['b', 'B'], ['a1', '']])
  const restored = restore(board, 2, 'human')
  assert.equal(restored.changeset!.label, 'restore rev 2')
  assert.deepEqual(restored.board.shapes.map((s) => s.text).sort(), ['', 'A', 'B'])
  assert.equal(board.log[0].agent, 'claude')
  assert.equal(shapesAt(board, -1), undefined)
})

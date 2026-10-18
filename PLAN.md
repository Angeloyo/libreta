# Libreta — plan

## Status (2026-10-17)

Built and tested end to end (core tests, browser checks in Orca, two agent evals; see `evals/`):

- **Engine** (`src/core`):
  - placement by intent, layout frames (row/col/grid/table), ELK diagrams
  - arrows routed around shapes, geometric problem checks
  - the text view and change summaries
  - SVG rendering shared by the browser and PNG renders
  - undo as changesets
- **Server and CLI:** `ls/new/mv/rm/open`, `read`, `apply`, `diagram`, `look`, `wait`, `undo`, `guide`. The CLI starts the server on its own.
- **Browser:**
  - live board, editor (select, move, resize, shape/arrow/text/sticky/frame/pen tools, text editing, style panel)
  - undo/redo, an "Undo Claude" button, a camera that follows the agent, a glow on what the agent changed
  - library sidebar (folders, rename, drag to move, delete to trash)
  - history panel (who did what, hover to highlight, view any past rev, restore, replay)
- **Agent skill:** `.claude/skills/libreta/SKILL.md`.

Next ideas:
- comments anchored to shapes
- teaching mode (step-by-step reveal)
- an in-app chat panel
- frames that reflow when a frame above them shrinks
- a "done" state for stickies
- making creating a shape and typing its label one undo step
- search and thumbnails
- an Electron or MCP wrapper if wanted

An AI-first infinite whiteboard. A human and an AI agent (Claude Code, driving a `libreta` CLI) draw on the same board in real time. The agent explains ideas visually; the human edits the board and the agent sees and understands those edits. Boards are saved locally and organized in folders.

**We build the whole thing: our own document model, renderer and editor. No third-party canvas engine.**

Research date: 2026-10-17. Items marked [unverified] come from a single secondary source.

---

## 1. Research summary

### 1.1 Existing products

| Product | AI sees human edits? | Local / open | MCP | Verdict |
|---|---|---|---|---|
| **tldraw offline** (Jul 2026) | Yes, by polling a localhost API | Local files, free, **closed source** | No (HTTP JS-exec API for Claude Code/Codex) [API details unverified] | Closest thing that exists. No folder library, no agent UX, can't be modified. |
| tldraw MCP App (Mar 2026) | Yes (canvas state goes back into chat context) | Hosted | Yes, `search` + `exec` (JS against the editor) | The board lives inside one chat. Reported 30s timeouts in claude.ai. |
| tldraw agent starter kit | Yes (user's recent actions, selection, viewport) | SDK template | Not MCP; in-app chat | The best reference design for how the agent sees the board (§1.2). |
| Excalidraw official MCP App | Partly: fullscreen edits come back as a text diff, debounced 2s | MIT | Yes (`read_me`, `create_view`) | One diagram per chat, no library. Floating arrows and overlaps are open issues (#33, #101). |
| yctimlin/mcp_excalidraw | Only when asked (`describe_scene`) | MIT, local | 26 granular tools | Raw coordinates; state in memory by default. |
| paper.design | Only when asked (selection, tree, JSX) | Closed, desktop + local MCP | Yes | Built for UI design. Free tier 100 MCP calls/wk, Pro $20/mo. About 400s per complex design. |
| Miro | Only when asked | SaaS | Yes: read/create/update **as SVG** with stable ids, plus comments | Dropped its custom layout DSL for SVG because "SVG sits in every model's training data." |
| Figma / FigJam | Only when asked (`get_figjam` returns an XML outline + screenshots) | SaaS | Yes: `use_figma` (plugin JS), `generate_diagram` (Mermaid) | Needs a full seat. |
| Eraser, Whimsical, Napkin, Mermaid Chart, draw.io, Lucid | Mostly no | Mixed (draw.io is open) | Mostly yes | One-shot generators. draw.io does server-side ELK layout and libavoid connector routing. |
| Obsidian Canvas (JSON Canvas), Heptabase, AFFiNE, Kosmik, Muse | Only by re-reading files | Some local-first | Community MCPs | Note-taking (PKM) canvases. No live agent, no layout engine. |
| cnvs.app, sshwarts/napkin, AetherDraw | napkin pushes a webhook diff 3s after edits stop, excluding the agent's own writes | Small / experimental | Yes / WebMCP | Small projects with good ideas: diff push, intent batching, dagre layout, obstacle routing. |

**Gap:** no product combines all four of these:
- a persistent board library organized in folders
- a live two-way agent
- local and open
- MCP

None of them solve these either:
- Nothing wakes a CLI agent when the human edits.
- Auto-layout ignores where the human placed things by hand.
- There's no teaching mode: no step-by-step reveal, no "look here".

### 1.2 Lessons for the agent interface (the hard part)

1. **Models are bad at raw coordinates.**
   - Every system that let the model place shapes by x/y ended up with overlapping boxes and arrows that cut through shapes or float loose (Excalidraw issues #33 and #101).
   - Benchmarks agree:
     - PlanarBench: the best model drew a crossing-free layout for 159.5 of 199 small graphs.
     - SiT-Bench (cognitive mapping): the best model scored 8%, against about 26% for humans.
   - → The model describes **structure and intent**: nodes, edges, containers, relative placement, layout kinds. **The engine handles pixels**: text measurement, arrow binding and routing, ELK layout.
2. **Screenshots are unreliable for catching overlaps.** On trivial geometry questions (BlindTest), vision models score about 58%.
   - → Compute lints geometrically and return them as text.
   - → Use screenshots only to judge the overall look, and only on request. A 1000×1000 image costs about 1.3k tokens.
3. **A compact text view is about 10× cheaper than raw element JSON**, and readable enough to reason about.
4. **Feed human edits back as plain-language diffs.** Debounce them, merge drags into one move, and leave out the agent's own writes. The Excalidraw App, the tldraw kit and napkin all do this.
5. **"Agents can't point" (tldraw).**
   - "This" means the human's selection.
   - Comments anchored to shapes are lasting pointers.
   - The agent points back by highlighting shapes.
6. **Few consolidated tools, meaningful short ids, and errors that say what to change.** Each tool should return a concise result by default (Anthropic, *Writing tools for agents*).
7. **One changeset per agent turn**, undoable as a single step and open to accept or reject (tldraw kit).
8. **A code-execution tool (tldraw `exec`, Figma `use_figma`) is flexible but hands raw coordinates back to the model.** Keep it as an escape hatch only.

### 1.3 Libraries (small, focused, MIT/ISC/OFL unless noted)

| Need | Pick | Notes |
|---|---|---|
| Hand-drawn look | rough.js | Deterministic with a seed, so the browser and the server render identical strokes |
| Freehand strokes | perfect-freehand | Turns pen points into an outline path |
| Auto-layout | elkjs (EPL-2.0) | Nested groups, orthogonal edges, runs in Node. d3-force for "tidy up" |
| PNG for the agent | @resvg/resvg-js (MPL-2.0) | Renders our SVG with our bundled fonts on the server. No browser needed |
| Font metrics | opentype.js (build step only) | Generates glyph-width tables so text sizing is deterministic everywhere |
| Schemas | Zod | One schema for ops, the CLI's HTTP API and the WebSocket protocol |
| Agent interface | A `libreta` CLI (Node, `node:util` parseArgs) + a Claude Code skill | Talks to the local server over HTTP. MCP comes later, only as a thin wrapper for clients without a shell (Claude Desktop) |
| Graph text format | Our own JSON nodes/edges/groups first; a small parser for a subset of Mermaid flowcharts later | The full Mermaid library needs a DOM, and `@mermaid-js/parser` doesn't cover flowcharts |

Considered and dropped:
- **tldraw:** license/watermark, its data model isn't ours, and its engine only runs in a browser.
- **Excalidraw:** binding bookkeeping on both sides, full-scene diffs.
- **Konva / Pixi / Fabric:** we don't need a scene-graph library for SVG.
- **CRDTs (Yjs / Loro / Automerge):** one human plus one agent doesn't need them.

---

## 2. Decision: build our own engine

**Why owning it is better for this product:**

1. **The data model is designed for the agent.**
   - Shapes carry meaning, not just geometry: slug ids, parent frame, layout intent, author, `pinned`.
   - Arrows reference shape ids; their geometry is computed at render time, so they can't float loose.
   - The text view the model reads is almost a direct printout of the document.
2. **One op vocabulary for the human and the agent.**
   - A human drag is `move`; an agent write is `create` / `connect` / ….
   - So the change log, "human since rev N", undo, and accept/reject are all the same mechanism.
3. **The engine is pure TypeScript and runs on the server.**
   - The server is authoritative: agent ops apply there directly, with no browser tab needed.
   - Screenshots render server-side (the same SVG renderer, via resvg).
   - This removes the weakest part of a tldraw-based design, where the engine could only live in a browser tab.
4. **No license key, no watermark, no usage reporting.**
5. **We only build what we need.** That's about 9 shape kinds, not a general design tool.

**The honest cost:** the editor feel.
- Selection, resize handles, on-canvas text editing, snapping, and binding arrows while dragging.
- That's where mature editors spent years polishing.
- Ours starts rougher, and we polish whatever bugs you.
- SVG performance is fine up to a few thousand shapes with viewport culling. That's plenty for diagrams.

---

## 3. Architecture

```
┌────────────────────────── Browser (Vite + React) ──────────────────────────┐
│  Sidebar: folders / boards     │  Canvas = core SVG renderer               │
│                                │  + editor: select, move, resize, text,    │
│                                │    tools, pan/zoom, undo                  │
│                                │  + agent cursor / highlights              │
│  Local replica of the doc: applies its own ops optimistically, sends them  │
└───────────────────────────────▲────────────────────────────────────────────┘
                                │ WebSocket: ops (with author + base rev), presence
┌───────────────────────────────┴────────────────────────────────────────────┐
│  Libreta server (Node, localhost) — authoritative                          │
│   core engine: apply ops · layout (ELK) · text metrics · arrows · lints    │
│   render: doc → SVG → PNG (resvg) for libreta look                         │
│   op log: rev, author, changeset → "human since", undo, accept/reject      │
│   library: ~/Libreta/**/*.board.json (real folders)                        │
│   HTTP API on localhost ← libreta CLI                                      │
└───────────────────────────────▲────────────────────────────────────────────┘
                                │ libreta read / apply / look / wait …  (via Bash)
                Claude Code          (later: in-app chat panel, optional MCP wrapper)
```

**`packages/core` is shared by the browser and the server.** It contains:
- the document model
- the Zod op schemas
- `apply(doc, op)`
- geometry (bounds, hit-testing, intersections)
- arrow routing
- text measurement
- layout
- lints
- the text-view serializer
- `render(doc) → SVG`

These are pure functions, so they're easy to test.

**Document model (sketch):**

```ts
type Shape = {
  id: string                       // slug, e.g. "api"
  kind: 'box' | 'ellipse' | 'diamond' | 'text' | 'sticky' | 'frame' | 'arrow' | 'freehand' | 'image'
  x: number; y: number; w: number; h: number
  text?: string
  parent?: string                  // frame id
  layout?: { kind: 'none' | 'row' | 'col' | 'grid'; gap: number; pad: number }   // frames
  from?: { id: string; side?: Side }; to?: { id: string; side?: Side }           // arrows
  points?: number[]                // freehand
  style: { color: ColorToken; fill: Fill; stroke: 'solid' | 'dashed' | 'dotted'; sketch: boolean; font: FontToken; size: SizeToken }
  meta: { by: 'human' | 'agent'; pinned?: boolean; createdRev: number; updatedRev: number }
}
```

**Sync:**
- The server holds the authoritative op stream.
- Clients apply their own ops optimistically and send them with `base_rev`.
- The server applies ops in order, bumps the rev and broadcasts.
- Conflicts are last-write-wins per field, except that agent ops skip fields the human changed after `base_rev`.
- Presence (selection, viewport, cursor) travels on the same socket.

**Agent write flow:**
1. Claude runs `libreta apply` with the ops on stdin, and the CLI posts them to the server.
2. The server validates the ops, resolves slugs and relative placement, measures text, lays out, and applies.
3. The result is one changeset with author = agent.
4. The server broadcasts it, and the tab animates it in.
5. Claude gets back a short diff, the lints, and what the human changed since its last call.

**Human edit flow:**
1. The editor emits ops (author = human).
2. The server logs them.
3. A shape the human moved by hand becomes `pinned`.
4. The next agent command includes the summary, and a running `libreta wait` returns at once.

**Storage:**
- Boards: `~/Libreta/<folders>/<name>.board.json` (our document format).
- Op logs and thumbnails: `~/Libreta/.libreta/`.
- The folder tree on disk is the library, so Finder and git work, and the agent can grep it.

**Fonts:**
- One bundled handwriting font (OFL) and Inter.
- Precomputed glyph-width tables mean `w: "auto"` gives the same size in the browser and on the server.

---

## 4. The agent interface

### 4.1 What the model reads (`libreta read`)

Rules:
- Short slug ids (chosen by the agent, or `s12`), never UUIDs.
- Indentation shows containment.
- Layout intent is visible.
- Arrows appear only as connections.
- Coordinates rounded to 10px.
- Author and `pinned` shown per shape.
- A header with the human's context, then computed relations and lints, then the changes since the agent last looked.
- Detail levels: `outline` (no geometry), `normal`, `full` (adds style, z-order, points).

```
board "Checkout flow" rev=57 · you=claude · you last saw rev 52
human: viewing (0,0 1600x900) · selected [db] · "this" = selection
frame backend "Backend" (520,80 680x440) layout=col gap=40
  box api    "API Gateway"  (560,140 240x80) blue
  box worker "Order worker" (560,260 240x80) violet
  box db     "Postgres"     (560,380 240x80) green  by=human
box web "Web app" (120,260 200x80) grey  pinned
a1 web -> api "REST"
a2 api -> worker "enqueue" dashed
a3 worker -> db "writes"
lint: a2 label overlaps worker (needs gap ≥ 60)
human since rev 52: added db · a3 text "SQL"→"writes" · moved web
```

### 4.2 What the model writes (`libreta apply`)

Ops go in on stdin through a quoted heredoc, so there are no shell-quoting problems. They are validated against a schema. Placement is relative (`in`, `after`, `right_of`, `below`…), and sizes default to `auto`.

```
libreta apply checkout --json <<'EOF'
{ "base_rev": 57, "label": "Add cache",
  "ops": [
    {"op": "create", "id": "cache", "shape": "box", "text": "Redis", "in": "backend", "after": "api"},
    {"op": "connect", "from": "api", "to": "cache", "text": "read-through"},
    {"op": "create", "id": "q1", "shape": "sticky", "text": "TTL 5m?", "place": {"right_of": "backend", "gap": 40}}
  ]}
EOF
```

The reply:

```
ok rev=58 changeset=cs7 · +cache in backend after api (worker, db shifted; backend grew)
+a4 api->cache · +q1 right of backend · lint: none · human since 57: none
```

Errors tell the model what to change:
- `op1: unknown id "cahce" — did you mean "cache"?`
- `worker is in a layout=col frame; use after/index, or set layout=none`
- `db.text was changed by the human at rev 59 ("Aurora"); your update was skipped`

**To test in evals: a write format that mirrors the read format.** The CLI is text in, text out, so the model could write in the same language it reads:

```
libreta apply checkout <<'EOF'
box cache "Redis" in=backend after=api
connect api -> cache "read-through"
sticky q1 "TTL 5m?" right-of=backend gap=40
EOF
```

JSON stays accepted (`--json`). Evals decide which one the model gets right more often.

Op vocabulary (the human editor uses the same one):
- `create` (box, ellipse, diamond, text, sticky, frame, freehand, …)
- `update`, `delete`, `connect`, `move`/`place`
- `arrange` (row, col, grid, tree, align, distribute, stack, fit-frame; optionally `live`, so a frame keeps its layout)
- `style`

### 4.3 CLI commands

Delivered by phase. With no board argument, a command uses the board currently open in the browser ("this board").

| Command | Phase | Purpose |
|---|---|---|
| `libreta ls` · `new` · `mv` · `rm` · `open` | 1 | Library: folder tree; create, rename, move or delete boards and folders. `open` shows a board in the human's browser |
| `libreta read [board]` | 1 | Text view (§4.1). `--scope all\|viewport\|selection\|frame:<id>\|ids:<a,b>`, `--detail`, `--since <rev>` |
| `libreta apply [board]` | 1 | Atomic batch of ops from stdin (§4.2). `--base-rev`, `--label`, `--dry-run`. Prints the diff, the lints and what the human changed |
| `libreta look [board]` | 1 | Renders a scope to PNG (≤1000px, about 1.3k tokens) and prints the file path, which Claude opens with its Read tool. `--badges` adds id labels; lint spots are highlighted |
| `libreta guide` | 1 | Style guide and format reference |
| `libreta wait [board]` | 2 | Blocks until the human edits (debounced) or comments `@claude`, then prints the summary and exits. Claude runs it in the background, so your edits wake it up |
| `libreta diagram [board]` | 1 | JSON nodes/edges/groups on stdin (later a Mermaid subset) → ELK layout → shapes in a frame. Re-running merges by id and keeps pinned shapes |
| `libreta undo [board] [changeset]` | 4 | List recent agent changesets, or revert one |
| `libreta point [board]` | 5 | Highlight shapes, show a "working here" region, or move the human's camera ("look here") |
| `libreta comments [board]` | 5 | List, reply to or resolve threads anchored to shapes |

**Conventions:**
- Output is compact text by default, with `--json` for scripts.
- If the server isn't running, the CLI starts it.
- Errors go to stderr and say what to change. Exit codes are non-zero on failure.

**How Claude learns it:**
- A Claude Code skill (`SKILL.md`) teaches the commands and the habits.
- One allowlist rule (`Bash(libreta *)`) removes permission prompts.

Possible later addition: `libreta exec`, a sandboxed JS escape hatch. Add it only if evals show a need.

**The style guide** lives in `libreta guide` and in the skill. It covers:
- the palette
- minimum sizes and spacing
- "use `diagram` for anything graph-shaped"
- "this = selection"
- "chunk big diagrams by frame"
- "read the lints before you finish"
- "start `libreta wait` in the background when you hand the board back to the human"

### 4.4 How the agent perceives human edits

1. **One op log** of `{rev, author, changeset}`, plus the agent's last-seen rev. Human and agent edits use the same ops.
2. **Every tool result ends with** `human since rev N: …` (at most 10 lines, then "run `libreta read --since <rev>`"). Changes are summarised by meaning, not raw records: merged drags, before → after for changed fields only, e.g. "moved worker into backend", "+sticky 'cache?' next to api".
3. **Human context in every read:** selection, viewport, cursor. "This" resolves to the selection.
4. **Respect for the human's work:**
   - Shapes the human placed by hand become `pinned`, and layout works around them.
   - Agent ops never overwrite a field the human changed after `base_rev`; the op is skipped and reported.
5. **Visible, undoable agent:** an agent cursor and a "working here" region. Each tool call is one undo step, with accept/reject in the UI.
6. **Push via `libreta wait` (Phase 2).**
   - Claude Code runs it in the background.
   - When you edit or comment `@claude`, it exits with the summary, and Claude Code wakes the agent.
   - Claude starts a new `wait` each time it hands the board back.
   - Later: an in-app chat panel for when you're not at a terminal.

---

## 5. Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces, TypeScript everywhere |
| Core | `packages/core`: pure TS (model, ops, geometry, arrows, text metrics, layout, lints, serializer, SVG renderer), plus rough.js, perfect-freehand, elkjs, Zod |
| Frontend | Vite + React. The canvas is the core SVG renderer plus our editor interaction layer (pointer events by hand) |
| Server | Node 24 LTS (tsx in dev): HTTP + `ws`, authoritative doc engine, file storage, resvg for PNG, HTTP API for the CLI |
| Agent interface | `libreta` CLI, installed globally with `pnpm link`. It talks to the server over localhost HTTP and starts it if needed. A Claude Code skill documents it. Optional MCP wrapper over the same API later |
| Tests | Vitest (most of the logic lives in pure `core` functions), Playwright for editor interactions |
| Desktop (later, optional) | Electron, which runs the Node server in-process |

Repo layout:

```
libreta/
  packages/core       model, ops, geometry, arrows, text, layout, lints, text view, SVG render
  apps/server         authoritative engine host, op log, library, PNG render, HTTP API
  apps/cli            the `libreta` command (talks to the server) + the Claude Code skill
  apps/web            Vite + React: viewer → editor, sidebar, presence
  evals/              scenarios, runner (claude -p + skill), reports
```

---

## 6. Phases

The order gets the AI drawing early, so we can tune its tools while the editor is built. Each phase ends with a demo.

0. **Core + live viewer.**
   - Document model, ops, `apply`, SVG renderer (sketch style), text metrics, arrows computed from their endpoint shapes.
   - Server with file storage and a WebSocket broadcast.
   - Browser viewer with pan and zoom.
   - *Demo:* a board file renders in the browser, and the server renders the same board as an identical PNG.
1. **Agent MVP.**
   - CLI with `ls/new/open`, `read`, `apply`, `look`, `guide`, `diagram` (JSON → ELK); op log; the Claude Code skill.
   - Placement engine: text sizing, layout frames (row/col/grid), relative placement, free-spot search, never moving human or pinned shapes.
   - Arrows clipped to shape borders, routed around obstacles; basic lints (overlap, overflow, arrow through shape).
   - Start the eval harness here.
   - *Demo:* in Claude Code, "draw how OAuth works" appears live in the browser, and Claude can look at its own result.
2. **Editor: the human's hands.**
   - Select, marquee, move, resize; shape, arrow, text, sticky, frame and pen tools.
   - Text editing on the canvas; arrows that bind when dropped on a shape.
   - Undo/redo, copy/paste, delete, keyboard shortcuts.
   - Every human edit becomes an op with author = human.
   - `libreta wait`, so your edits wake Claude up.
   - *Demo:* the full loop. You move, rename and add shapes; Claude's next call sees it and responds.
3. **Library UI.**
   - Folder tree sidebar; create, rename, move and delete boards and folders; a route per board; recents.
   - *Demo:* boards organized in folders, the same files visible in Finder.
4. **Make the drawings good.**
   - `arrange` ops, incremental layout that respects pinned shapes, more lints with autofix.
   - Reading your pen strokes as meaning: "circled api + worker", "arrow from web to db", "scribbled over cache".
   - Style presets, pinned-aware layout, `libreta undo` and accept/reject UI.
   - Agent cursor, shapes animating in one by one, camera follow.
   - Snapping and guides in the editor.
5. **Talk on the board.**
   - Comments anchored to shapes, `libreta point`, teaching mode (step-by-step reveal of a diagram).
   - In-app chat panel, a Mermaid flowchart subset, search across boards, thumbnails, optional MCP wrapper, optional Electron.

## 7. Evals (start in Phase 1)

About 15 scenarios:
- **Generate:** architecture, flowchart, sequence-like, mind map, comparison, "explain X visually".
- **Collaborate (from Phase 2):** the human moves, renames or deletes, then asks a follow-up; "change this" with a selection; adding to a crowded frame.

The runner drives `claude -p` with the Libreta skill and the `Bash(libreta *)` allowlist against a fresh board, and records:
- tool calls, time and tokens
- lint counts: overlaps, overflowing text, dangling arrows, arrows through shapes
- a final PNG for review

We change tool descriptions and the text format based on what these transcripts show.

## 8. Risks / open questions

- **The editor feel is the biggest build.** Text editing on the canvas and drag-to-bind arrows are the fiddliest parts. We polish what bugs you in daily use.
- **Text measurement drift** between the glyph tables and how the browser actually renders text (kerning, ligatures). Keep a small safety padding, and test with screenshots in Playwright.
- **The agent only sees edits when it runs a command**, unless a `libreta wait` is running in the background. The summaries attached to every result cover the rest.
- **Shell quoting:** ops always go on stdin via a quoted heredoc, never as arguments.
- **Incremental layout that respects human placement is the hardest problem.** v1 re-lays out only unpinned shapes, and only when asked.
- **Unverified so far:** tldraw offline API details (reference only).

## Sources

- tldraw (reference designs): tldraw.dev/blog/tldraw-offline · tldraw.dev/starter-kits/agent · github.com/tldraw/tldraw/tree/main/templates/agent · github.com/tldraw/tldraw/tree/main/apps/mcp-app · tldraw.dev/blog/agents-cant-point
- Excalidraw: github.com/excalidraw/excalidraw-mcp (issues #33, #101) · github.com/yctimlin/mcp_excalidraw · plus.excalidraw.com/pricing
- Other products: developers.miro.com/docs/miro-mcp-tools · developers.figma.com/docs/figma-mcp-server/tools-and-prompts · github.com/jgraph/drawio-mcp · paper.design/docs/mcp · braintrust.dev/blog/paper-vs-figma-mcp
- Research: arxiv.org/html/2606.02010 (PlanarBench) · arxiv.org/html/2601.03590 (SiT-Bench) · arxiv.org/abs/2407.06581 (BlindTest)
- Claude and MCP: anthropic.com/engineering/writing-tools-for-agents · platform.claude.com/docs/en/build-with-claude/vision · modelcontextprotocol.io/extensions/apps/overview · code.claude.com/docs/en/mcp · code.claude.com/docs/en/channels

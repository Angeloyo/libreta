# Libreta

A whiteboard you and Claude draw on together. Claude draws through the `libreta` CLI; you see it
live in the browser and edit the same board by hand; Claude sees your edits.

```
 Browser: canvas + editor + board library
      ▲ WebSocket (changes, what you're looking at, your selection)
 Server (localhost:4747): the boards, layout, checks, PNG renders, change log
      ▲ HTTP
 libreta CLI  ◄── Claude Code (via the libreta skill)
```

## Setup

```sh
npm install
npm run build                                        # builds the web app the server serves
ln -s "$PWD/bin/libreta" ~/.local/bin/libreta        # puts `libreta` on your PATH (any folder on PATH works)
```

Boards live in `~/Libreta` as plain files (`Work/Checkout flow.board.json`), so folders, Finder
and git all work. Deleted boards go to `~/Libreta/.trash`. Set `LIBRETA_HOME` to use another folder.

To let Claude Code use it in any project, link the skill:

```sh
ln -s "$PWD/.claude/skills/libreta" ~/.claude/skills/libreta
```

## Using it

```sh
libreta new "Ideas/First board" --open   # the server starts by itself
```

Then ask Claude to explain something on the board. Claude will:

- run `libreta read` to see the board, what you have selected, and what you changed
- draw with `libreta diagram` (auto-laid-out graphs) or `libreta apply` (anything else)
- check its work with `libreta look` (a PNG of the board)
- run `libreta wait` in the background, so your edits wake it up

In the browser:

| Key | Action |
|---|---|
| `v` | select |
| `h` | pan |
| `r` | box |
| `o` | ellipse |
| `d` | diamond |
| `a` | arrow |
| `t` | text |
| `n` | sticky |
| `f` | frame |
| `p` | pen |
| Enter / double-click | edit text |
| ⌫ | delete |
| ⌘Z / ⇧⌘Z | undo / redo |
| ⇧1 | fit to content |
| space-drag, scroll | pan |
| ⌘-scroll, pinch | zoom |

The "Claude changed this · Undo" button rejects Claude's latest change.

## Development

```sh
npm run server         # the server, restarting on changes (port 4747)
npm run web            # Vite dev server on :5173 with hot reload; set LIBRETA_WEB_URL=http://localhost:5173 for `libreta open`
npm test               # engine tests
npm run check          # type-check
```

Code map:

- `src/core`: the engine, shared by server and browser
  - `model.ts`: the board format
  - `ops.ts`, `dsl.ts`: the edit operations and the line format
  - `apply.ts`, `layout.ts`, `arrows.ts`, `text.ts`: placement, routing, measurement
  - `lint.ts`, `view.ts`, `ink.ts`: what the agent reads
  - `render.ts`: SVG
  - `diagram.ts`: ELK auto-layout
- `src/server`: the HTTP API for the CLI, the WebSocket for browsers, the library on disk
- `src/cli`: the `libreta` command
- `src/web`: the React app
  - `canvas/view.ts`: rendering and camera
  - `canvas/editor.ts`: tools and gestures
- `.claude/skills/libreta/SKILL.md`: how Claude should use it (also printed by `libreta guide`)

## Credits

The hand-drawn font is [Shantell Sans](https://github.com/arrowtype/shantell-sans) by Shantell
Martin and Arrow Type, under the SIL Open Font License (`assets/fonts/OFL.txt`).

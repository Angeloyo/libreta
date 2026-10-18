---
name: libreta
description: Draw on Libreta, a whiteboard the user and Claude share. Use it whenever an idea is easier to see than read — architecture, flows, plans, comparisons, explanations for a visual learner — or when the user mentions their board, a sketch, or "look at this". Drives the `libreta` CLI.
---

# Libreta: drawing with the human

Libreta is a whiteboard open in the human's browser. You draw on it with the `libreta` command;
they see every change live and edit the same board by hand. You describe **what** to draw and
**where relative to other things**; the engine handles pixels: text sizing, layout, arrows
that attach to shapes and route around them, and overlap checks.

## The loop

1. **Catch up at the start of every turn.** The first time, run `libreta read "<board>"` to see
   it all: every shape, frame and arrow, what the human has selected, and open problems. After
   that, each time the human writes to you, run `libreta changes "<board>"` before anything else.
   They may have been editing the board for a while: that's what their message is about.
2. Draw with `libreta diagram` (anything graph-shaped) or `libreta apply` (everything else).
3. Read the reply: what changed, and `problems:`. Fix problems before moving on. If it starts with
   "⚠ before your change, the human had edited the board", you skipped step 1: look at what they
   did and make sure your change still makes sense.
4. `libreta look` once at the end of a big change, and open the PNG with your Read tool to
   check it reads well. Don't use screenshots to hunt for overlaps; `problems:` is exact.
5. Then just answer and stop. **Don't watch the board**: the human edits at their own pace and
   tells you when to look. Only if they ask you to react live ("watch the board", "tell me when I
   change something") run `libreta wait "<board>"` in the background. It returns when they edit.

**Name the board in every command**: `libreta read "Work/Checkout flow"`, `libreta apply
"Work/Checkout flow" <<'EOF'`. Without a name, commands use the board open in the browser, and
refuse to guess if several are open. Every reply names the board it acted on. `libreta ls` lists
boards; `libreta new "Folder/Name" --open` creates one and shows it to the human.

## `libreta apply` — the line format

Ops go on stdin, one per line, in a quoted heredoc. The format mirrors `libreta read`, so any
line you read is a valid line to write.

```
libreta apply --label "Add cache" <<'EOF'
frame backend "Backend" layout=col
box api "API Gateway" in=backend blue
box cache "Redis" in=backend after=api orange
ellipse user "User" left-of=backend gap=120
diamond ok "Valid?" below=api
sticky q1 "TTL 5 min?" right-of=backend
text note "Reads hit Redis first" below=backend
user -> api "HTTPS"
api -> cache "reads" dashed
connect a9 api <-> cache
update cache text="Redis cluster" color=red
move q1 below=note
delete note
EOF
```

- **Shapes:** `box`, `ellipse`, `diamond`, `text`, `sticky`, `frame`. Then an id (short words like
  `api`, `db-2`; reuse them later), then the text in quotes.
- **Arrows:** `a -> b "label"`. Use `<->` for both ends, `--` for no heads. `connect <id> a -> b`
  names the arrow. Arrows stick to their shapes, so moving a shape takes its arrows along.
- **Placement**, from best to worst:
  - `in=<frame>`: inside a layout frame, the frame arranges its children and you order them
    with `after=` / `before=`.
  - `right-of=` / `left-of=` / `above=` / `below=` / `near=` another shape, optionally with
    `gap=` and `align=start|center|end`.
  - Nothing at all: the shape goes next to what it's connected to, or right of the last shape
    you placed, or in free space where the human is looking.
  - `at=(x,y)` as a last resort.
- **Frames:** `layout=col|row|grid|none`, `spacing=`, `cols=`. A frame without a layout keeps
  children where you put them and grows to fit them; `update <frame> fit` shrinks it back to hug
  them.
- **Style:** colors `black grey blue violet green yellow orange red pink` (bare words),
  `fill=light|solid`, `dashed` / `dotted`, `size=s|m|l|xl` (on a frame, the title's size).
- **Size:** leave it out and the shape fits its text. Give only `w=` and the height grows to
  fit (best for paragraphs: `text note "…" w=360`). Give both to fix the size. `"\n"` in text
  starts a new line. The font has no emoji or circled digits (①); `problems:` flags characters it
  can't draw.
- **Changing things:** `update <id> key=value…`, `move <id> <placement>`, `delete <id> [id…]`.
- **Tables:** `table <id> "Caption"` followed by markdown rows. The first row is the header;
  columns size to their content; cells are named `<id>-r<row>c<col>`:
  ```
  table urls "urls table" green right-of=api
  | code | long_url | created |
  | aZ3x9 | https://example.com/a/long/path | 2026-10-17 |
  ```
  Change a cell with `update urls-r2c1 text="…"`. Add a row by creating one box per column
  `in=urls`.
- The whole batch is atomic: one error and nothing is applied. Errors name the line and what
  to change. `--dry-run` previews a batch without saving it. `libreta undo` takes back your last
  change.
- Placements are resolved after every frame in the batch has its final size, so
  `frame b right-of=a` is safe even when `a` grows later in the same batch.

## `libreta diagram` — automatic layout

For flows, architectures, trees, pipelines: list the nodes, groups and arrows, and ELK lays
them out with no overlaps and few crossings. Same line format; positions are ignored.

```
libreta diagram --frame oauth --title "OAuth code flow" --direction right <<'EOF'
ellipse user "User" blue
frame app "Your app"
box web "Web app" in=app
box server "App server" in=app
frame idp "Auth server" violet
box login "Login page" in=idp violet
box token "Token endpoint" in=idp violet
user -> web "clicks Log in"
web -> login "redirect"
login -> web "code"
web -> server "code"
server -> token "code + secret"
token -> server "access token"
EOF
```

- `--frame <id>` wraps the diagram in a frame. Running it again with the same id **revises**
  it in place: nodes with the same ids are kept and moved (so arrows the human drew to them
  survive), nodes you left out are removed, and the human's own shapes are never touched.
  `--dry-run` previews it.
- Where it goes: below your previous frame, so step-by-step frames read top to bottom. Or put it
  beside a shape with `--below <id>`, `--right <id>`, `--left <id>` or `--above <id>` (plus
  `--gap`).
- `--direction right` suits flows and pipelines; `down` suits hierarchies and trees.
  `--spacing compact` packs it tighter. `--size l` gives the frame a bigger title.
- Keep one diagram to about 15 nodes. For more, draw several framed diagrams and connect them.
- To explain a diagram, add notes afterwards with `apply`: e.g. `text n1 "…" w=360 in=<frame>
  below=<node>`. Or put several notes side by side in a `layout=row` frame under the diagram.

## Drawing well (for a visual learner)

- One idea per frame. Give every frame a title that states the point ("Reads hit the cache
  first"), not just a category name.
- Labels are 1–4 words. Put the explanation in a `text` or `sticky` next to the diagram, not in
  the boxes.
- Color carries meaning. Pick one color per role and keep it: e.g. blue for clients, violet for
  services, green for data stores, orange for things that are new or changed, red for problems.
  Most shapes should stay black.
- Use `sticky` (yellow) for open questions, decisions and TODOs addressed to the human.
- Use `dashed` arrows for async or optional paths and solid ones for the main path.
- Build big explanations step by step: frame 1, then frame 2 below it, and so on. The human
  watches each part appear (their view follows what you draw).
- Prefer a small picture over a paragraph: a table of example rows, a before/after pair of
  boxes, one concrete example that runs through every frame.
- Keep paragraphs short: 1–3 sentences per note.

## Working with the human

How their edits reach you (from `libreta changes`, `libreta read`, and at the top of your replies):
- `+ sticky h3 "…" · right of q3, outside frame qs`: a new shape and what it's next to. A sticky
  next to your question is usually their answer to it.
- `q4 text "…" → "…"` (or `text: appended "…"` for long texts): they edited your words.
- `+ pen h5 circles q2` / `crosses out q5` / `strikes through x` / `underlines x` /
  `line from a to b`: what a freehand stroke marks. Crossed out usually means "drop this",
  circled or underlined means "this one". If unsure, say how you read it on the board.
- `+ h7 h6 -> known`: they drew an arrow from their note to one of your shapes: the note is
  about that shape.
- `selection changed: nothing → [q1]`: they are pointing at q1 right now.
- Shapes they create get ids `h1`, `h2`, …
- `libreta history "<board>"` lists who changed what, newest first (`rev 21 · human · Connected
  “What if…” → “Google ID linked?”`). It's handy when you come back to a board after a while.
  They can also browse the history, replay it, and restore old versions in the browser. A restore
  reaches you as their change.

- `by=human` marks what they made. `pinned` marks shapes they placed by hand. Don't move, restyle
  or delete their things unless they ask. Add next to them instead.
- "This", "these" and "here" mean their selection, shown in the `human:` line of `libreta read`.
  `libreta read --scope selection` shows just that.
- If you try to change something they edited since you last looked, the engine skips it and
  says so. Read their version and adapt.
- They can reject your latest change with one click (an "Undo" button in the browser). If they
  do, you'll see it as their change: read it and ask, rather than redrawing the same thing.
- `libreta look --scope selection` (or `--scope frame:<id>`, or `--scope a,b`) shows a picture
  of that area of the board, including the human's pen marks over it. Use it when the words
  above aren't enough to understand a drawing.

# Eval 1: "Explain a URL shortener" on board Evals/URL shortener

Final state: rev 19, 4 frames, 64 shapes, 24 arrows, `problems: none`.
Frames, stacked top to bottom:
1. Architecture: a write path and a read path around one table
2. Shorten: a unique number becomes a short code
3. Click: look up the code, answer with a redirect
4. Storage: one row per link, found by its code

One example runs through frames 2–4: ID 162314955 → base62 `aZ3x9` → row `aZ3x9` → redirect.

---

## 1. Every libreta command, in order

All commands were run from `/Users/angel/Documents/angel/libreta`. Heredoc bodies are shortened to what matters.

| # | Command | Result / error output (verbatim where relevant) |
|---|---|---|
| 1 | `./bin/libreta read` | Returned **`board "First board" rev=15`** (Test/First board), not the target board. The brief said "Evals/URL shortener" was open in the browser. |
| 2 | `./bin/libreta ls` | `Evals/ URL shortener` · `Test/ First board` |
| 3 | `./bin/libreta --help` | Showed the `[board]` positional argument (the skill never mentions it). |
| 4 | `./bin/libreta read "Evals/URL shortener"` | `board "URL shortener" rev=0 · empty` · `human: viewing (-670,-600 1340x1200)` · `problems: none` |
| 5 | `./bin/libreta guide` | Same text as SKILL.md. |
| 6 | `./bin/libreta diagram "Evals/URL shortener" --frame arch --title "1 · Architecture: …" --direction right` (10 nodes incl. a nested `app` frame, 9 arrows) | ok rev=1, frame 2230x470, `problems: none` |
| 7 | `./bin/libreta look "Evals/URL shortener" --scope frame:arch` | PNG r1, opened |
| 8 | `./bin/libreta apply … --dry-run --label "Arch notes"` (2 `text … in=arch below=… w=520`) | would make rev 2, `problems: none` |
| 9 | same, without `--dry-run` | ok rev=2 |
| 10 | `./bin/libreta diagram … --frame write --title "2 · Shorten: …" --direction right` (8 nodes, 7 arrows) | ok rev=3, `problems: none`. **The frame was placed above frame 1** at (-1560,-530), 3130 px wide. |
| 11 | `./bin/libreta apply … --label "Stack frame 2"`: `move write below=arch align=start gap=80` | ok rev=4 |
| 12 | `./bin/libreta apply … --label "Shorten notes"` (3 `text … in=write right-of=… w=…`) | ok rev=5 but:<br>`- text in w-base62 doesn't fit — make it taller (h ≥ 78) or shorten it`<br>`- text in w-hash doesn't fit — make it taller (h ≥ 104) or shorten it` |
| 13 | `./bin/libreta apply … --label "Fix note sizes"`: `update w-base62 h=80`, `update w-hash h=106` | ok rev=6, but `w-base62 resized 400x60 → 480x80`, `w-hash resized 440x80 → 470x110`: **widths changed too** |
| 14 | `./bin/libreta diagram … --frame read --title "3 · Click: …" --direction right` (8 nodes, 8 arrows) | ok rev=7. **Placed above everything again** at (-1380,-560). |
| 15 | `./bin/libreta apply … --label "Stack frame 3 + notes"` (`move read below=write …` + 2 texts) | ok rev=8, `problems: none` |
| 16 | `./bin/libreta apply … --dry-run` (storage table, `layout=grid cols=4 spacing=0`, auto-sized cells) | no problems, but cells of different widths were centered in equal-width slots: a ragged table |
| 17 | `./bin/libreta apply … --dry-run` (same, all cells `w=300 h=70`) | `- text in c12 doesn't fit — make it taller (h ≥ 84) or shorten it` |
| 18 | `./bin/libreta apply … --dry-run` (full frame 4: `urls` grid + `frame clicks … right-of=urls` grid, in one batch) | 36 overlap problems:<br>`- h2 and k1 overlap — move one, e.g. move k1 below=h2`<br>`- h2 and k11 overlap — move one, e.g. move k11 below=h2`<br>`- h3 and k1 overlap — move one, e.g. move k1 below=h3`<br>`…`<br>`- ...and 24 more (libreta read shows all)` |
| 19 | `./bin/libreta apply … --label "Storage: urls table"` (frame `store` + `urls` grid only) | ok rev=9, `problems: none` |
| 20 | `./bin/libreta apply … --label "Storage: clicks table + notes"` (`clicks` grid, `right-of=urls`) | ok rev=10, `problems: none` (split into two batches to work around #18) |
| 21 | `./bin/libreta apply … --label "Storage notes"` (3 texts) | ok rev=11 but `- text in s-scale doesn't fit — make it taller (h ≥ 130) or shorten it` |
| 22 | `./bin/libreta apply … --label "Fix s-scale size"`: `update s-scale h=132` | ok rev=12 (`470x110 → 480x130`: width changed again) |
| 23 | `./bin/libreta look "Evals/URL shortener"` | PNG r12, opened |
| 24 | `./bin/libreta apply … --dry-run` (testing `\n` in `text=` and `update arch size=l`) | ok |
| 25 | `./bin/libreta apply … --label "Readability fixes"` (new texts for w-steps/w-base62, `size=l` on 4 frames, `size=s` on 3 URL cells) | ok rev=13 but `- text in w-steps doesn't fit — make it taller (h ≥ 156) or shorten it` |
| 26 | `./bin/libreta look … --scope frame:write` | PNG r13 (not opened, the problem was already known) |
| 27 | `./bin/libreta apply … --label "Fit steps"`: `update w-steps h=160` | ok rev=14 |
| 28 | `./bin/libreta look … --scope frame:write` | PNG r14, opened |
| 29 | `./bin/libreta apply … --label "Space notes"` (`update w-base62 w=420 h=110`, 2× `move … right-of=… align=start`) | ok rev=15 |
| 30 | `./bin/libreta look … --scope frame:store` | PNG r15, opened |
| 31 | `./bin/libreta apply … --label "Shorter URLs + follow-up"` (2 text updates + `sticky next … in=store right-of=s-scale`) | ok rev=16 |
| 32 | `./bin/libreta look "Evals/URL shortener"` | PNG r16 |
| 33 | `./bin/libreta look "Evals/URL shortener" --no-badges` | **Same path as #32** (`…-r16.png`), so it overwrote the badged render |
| 34 | `./bin/libreta read "Evals/URL shortener" --detail outline` | `problems: none` |
| 35 | `./bin/libreta read "Evals/URL shortener" \| tail -5` | `problems: none` |
| 36 | `./bin/libreta apply … --label "Complete legend"` (legend text with `\n`, `w=520 h=70`) | ok rev=17 but `- text in legend doesn't fit — make it taller (h ≥ 104) or shorten it` |
| 37 | `./bin/libreta apply … --dry-run`: `update legend w=640 h=80` | `problems: none` |
| 38 | `./bin/libreta apply … --label "Legend size"`: same | ok rev=18 |
| 39 | `./bin/libreta look … --scope frame:arch --no-badges` | PNG r18. **The renderer wrapped "fallback" onto a 3rd line** even though the engine said it fit |
| 40 | `./bin/libreta apply … --label "Legend width"`: `update legend w=720 h=80` | ok rev=19 |
| 41 | `./bin/libreta look "Evals/URL shortener" --no-badges` | PNG r19, opened: final check |
| 42 | `./bin/libreta read "Evals/URL shortener" \| tail -3` | **`problems: none`** |

No command failed outright. There were no parse errors and no rejected batches.

---

## 2. Confusing, missing or surprising

1. **Which board is "open"?** Plain `libreta read` went to *Test/First board*, but the brief said *Evals/URL shortener* was open, and `read "Evals/URL shortener"` also reported a human viewport for it. Two tabs may be open. Nothing says which one wins. The skill never shows the `[board]` positional argument; I found it only in `--help`. An agent that trusts the default would have drawn on the wrong board, and would have broken the "don't touch other boards" rule.
2. **`diagram` puts new frames above existing content.** The skill says "frame 2 to its right", but `diagram` has no placement flag. Frames 2 and 3 both appeared above frame 1, so each needed a follow-up `move`. The human sees every frame jump.
3. **The engine's own text sizing fails its own fit check.** Five times, a text the engine had just auto-sized was reported as "doesn't fit" (w-base62, w-hash, s-scale, and w-steps/legend after `update text=`). If I don't give a size, the engine should pick one that passes its own check. `update text=` doesn't re-fit the box either.
4. **`update h=` also changes `w`** (400→480, 440→470, 470→480). This pushed w-base62 flush against w-hash (0 px gap). The overlap check doesn't flag touching shapes, but in the PNG the two paragraphs ran together.
5. **Engine and renderer measure text differently.** The legend at 640x80 passed the check (`problems: none`), but the PNG wrapped it to three lines that overflowed the box.
6. **Placements in a batch are resolved before layout.** `frame clicks … right-of=urls` was resolved against `urls` before the grid grew, which caused 36 overlaps. The suggested fixes made it worse: "move k1 below=h2" would pull a grid cell out of its table. The right hint is "move clicks right-of=urls", or simply doing layout first.
7. **No table primitive.** Grid layout uses equal slots sized to the largest cell and centers each cell, so a table only lines up if every cell has the same `w`/`h` and `spacing=0`. You can't set per-column widths, so narrow columns (code, user) waste space and the header row is as tall as the tallest data row.
8. **Missing glyphs fail silently.** `①②③④⑤` and the superscript in `62⁷` rendered as blank space in the PNG. No warning.
9. **URLs wrap mid-word** (`autumn?ut / m=mail`, `big-st / ory`). Wrapping should break at `/ ? . -`.
10. **`size=l` on a frame was accepted and reported (`arch size m → l`)**, but the frame title in the PNG didn't change. At full-board zoom, frame titles are the smallest text on the board.
11. **`\n` in quoted text works but isn't documented.** I only found out by trying.
12. **`look` and `look --no-badges` write the same filename** (`…-r16.png`), so the second overwrites the first.
13. **Text is centered vertically in its box**, so side-by-side notes with `align=start` don't line up at the top when their line counts differ.
14. **`diagram` frames are very wide.** Frame 2 is 3130 px for 8 nodes, mostly from spacing reserved for edge labels. There is no spacing or compaction option.
15. Good surprises: `--dry-run` with exact `problems:` was the most useful feature. `--detail outline` is a clean summary. `move` carrying arrows and children along worked perfectly. Error and problem messages always named the shape and gave a number.

---

## 3. Tool design changes that would make drawing faster or better

1. **Placement for `diagram`**: `--below <id>` / `--right-of <id>` / `--gap`. Or by default, place a new diagram frame after the last frame the agent drew, in reading order. This would have saved 2 batches and 2 visible jumps.
2. **Fit text automatically**: when `w`/`h` aren't given, and on `update text=`, grow `h` until the text fits. Never report a fit problem for a size the engine chose. Use the renderer's measurement, or share one text-measurement function between engine and renderer.
3. **`update h=` should leave `w` alone** unless asked. Add a min-gap warning (for example under 16 px between siblings) next to the overlap check.
4. **Two-pass batches**: run layout for frames before resolving `right-of=`/`below=` that reference them. Overlap hints should never suggest moving a child out of a layout frame. Suggest moving the top-level shape instead.
5. **A `table` op**, because explaining "how data is stored" is common:
   `table urls "urls (URL database)" cols="code*,long_url,created" rows="aZ3x9|shop…|2026-10-17; …" green`
   with column widths that fit their content, a header style, a key-column marker, and per-cell highlight (`highlight=1,1 orange`). Today the same thing takes about 13 shape lines plus manual `w`/`h` on every cell.
6. **Unsupported glyphs**: list them under `problems:` (`w-steps uses ① which the board font can't draw`), or bundle a fallback font.
7. **URL-aware wrapping**: allow breaks after `/ ? & . -`.
8. **Frame titles**: make `size=` scale the title, or default the title size to the frame's area so titles stay readable at full-board zoom.
9. **Notes attached to a diagram**: e.g. `note n1 "…" for=enc` or a `--notes below` section, so explanation text is placed and top-aligned in a row under the flow without hand-chained `right-of`.
10. **Board selection safety**: every reply should name the full board (`board "Evals/URL shortener"`), not just "URL shortener". If more than one tab is open and no board is given, refuse or warn. Document `[board]` in SKILL.md.
11. **`look` file names** should include scope and options (`…-r16-frame-arch-nobadges.png`).
12. **Diagram spacing**: `--spacing compact|normal|loose`, or place edge labels so they don't force huge gaps between ranks.
13. Optional: **step numbers on arrows** (`a14 … step=3`) so a numbered list in a note maps to badges on the flow. That's a good visual-learner pattern I couldn't express.

---

## 4. Honest critique of the final board (rev 19, from the PNG)

**What works**
- All four parts are there, each in its own frame: architecture, shorten flow, click/redirect flow, storage. The titles state the point, not just a category.
- Colors mean the same thing everywhere: blue for people, violet for services, green for storage, orange for the running example, red for errors, dashed for async/fallback. The legend now explains all of them.
- One concrete example threads through frames 2–4: 162314955 → base62 → `aZ3x9`, then the click on `bit.ly/aZ3x9`, then the `aZ3x9` row in the table, then click rows for `aZ3x9`. The next codes, `aZ3xa` and `aZ3xb`, show that counter IDs come out in order.
- The tables make storage concrete instead of a single "DB" box. Error paths (400, 404) and the async click log are shown without cluttering the main path.
- No overlaps, and every text fits in the final render.

**What doesn't work as well**
- **Weak visual hierarchy:** frame titles are the smallest text on the board at full zoom. A reader scanning the board can't easily see "1 → 2 → 3 → 4". `size=l` didn't help.
- **Unbalanced frames:** the widths are 2230 / 3130 / 2770 / 1670 px. Frame 2 is a long thin strip with empty space on the right. Frame 4 is narrow and tall, with a lone sticky. Stacking vertically was my choice (left-to-right would be about 10,000 px wide), but it isn't the "frame 2 to the right" the skill suggests.
- **Frame 1 order:** ELK put *URL database* between *ID generator* and *Redis cache*. So the read path (check the cache first, then the database on a miss) doesn't read top-to-bottom, and the "on miss" and "lookup" arrows nearly run parallel.
- **Frame 3:** the cache-hit arrow is a long line that runs under *URL database*. The miss path goes up and comes back down. Filling the cache after a miss isn't drawn, only implied.
- **Too much text for a visual learner:** each frame has 2–3 paragraphs in small type. The base62 idea in particular deserves a small picture (digits being converted) instead of a sentence. The 1–5 step list in frame 2 isn't tied to the arrows, so the reader has to match them up.
- **Table details:** the URL column uses a smaller font (`size=s`) than its neighbors, and the URLs were shortened so they'd fit. The header row is as tall as the data rows (90 px) because grid rows share one height. The empty right half of frame 4 and the narrow sticky look unfinished.
- The architecture frame repeats services that come back in frames 2 and 3 (Shorten API, Redirect service, URL database, Redis cache). That's consistent, but nothing visually links them across frames, such as cross-frame arrows or a "zoom-in of ..." marker.

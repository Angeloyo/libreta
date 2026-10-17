# Eval 2 report: planning "Sign in with Google" on "Evals/Google login"

Final board: rev 24. Five frames: `flow` (1. the flow), `data` (2. data changes), `qs` (3. questions, now all answered), `decided` (decisions made from the human's answers) and `linking` (the answer to the human's email_verified question). There are also green reply notes next to each human sticky. I ran 3 feedback rounds (the cap) and did not start a 4th wait.

## 1. libreta commands, in order

No command exited non-zero and none printed an error. The only `problems:` line came from a dry-run (#37), quoted verbatim there.

| # | command | result |
|---|---|---|
| 1 | `./bin/libreta --help` | usage |
| 2 | `./bin/libreta read "Evals/Google login"` | `rev=0 · empty`, human viewing (-670,-600 1340x1200), nothing selected |
| 3 | `./bin/libreta guide` | same text as SKILL.md |
| 4 | `./bin/libreta diagram "Evals/Google login" --frame flow --title "1. The flow: one trip to Google, then your normal cookie session" --direction right --size l` (13 nodes, 12 arrows) | rev 1, problems: none |
| 5 | `./bin/libreta look "Evals/Google login" --scope frame:flow` | PNG. ELK put Google left of the app, so the steps zig-zag. Arrow `a10 "insert"` runs along the top edge of the session box, yet problems said none |
| 6 | same `diagram --frame flow` again, with arrow labels numbered "1 clicks" … "8 Set-Cookie" | rev 2. The reply contradicts itself: it lists `btn moved…`, `a1 text "clicks" → "1 clicks"`, and also `notes: - also removed arrow a1 (it was attached to flow)` … `- also removed user, btn, app, … (inside flow)` |
| 7 | `apply --label "Flow notes" --dry-run` (row frame `flownotes` with 3 notes + legend, `in=flow below=app`) | ok; `flow resized 2840x430 → 3060x620` (it got wider, unexpectedly) |
| 8 | `apply --label "Flow notes"` | rev 3 |
| 9 | `apply --label "Data changes" --dry-run` (frame `data`, 2 tables, arrow, 3 texts) | ok, but the output was cut off: `...and 1 more` hid where `sql` would go |
| 10 | `apply --label "Data changes"` | rev 4. `dn1 below=users` landed at y=1090 when the table ends at 770 (gap ~280px). The `users` table sat 320px in from the frame's left edge |
| 11 | `look --scope frame:data` | confirmed the big empty areas |
| 12–13 | `apply --label "Tidy data notes"` (`move dn1 below=users gap=40 align=start`, etc.), dry-run then real | rev 5. Notes moved, **but the frame did not shrink** (still 1640x830) |
| 14 | `read --scope frame:data --detail outline` | no geometry. Header said `49 shapes, 1 arrow` (49 is the board total, 1 is the scoped arrow count?) |
| 15 | `apply --label "Open questions"` (grid frame `qs`, stickies q1–q5, hint text `qhow`) | rev 6 |
| 16 | `look` (whole board) | data frame still mostly empty |
| 17 | `read --scope data --detail full` | geometry |
| 18 | `apply --dry-run` `update data layout=col` | would stack everything in one column (rejected) |
| 19 | `apply --dry-run` `update data layout=grid cols=2` | would be 1900 wide (rejected) |
| 20 | `apply --dry-run` `update data w=1340 h=560` | `data resized 1640x830 → 1640x560`. **w was silently ignored** because the frame keeps its x |
| 21–22 | `apply --label "Tighten data frame"`: `move users at=(-490,580)`, then relative moves, then `update data w=1340 h=560` | rev 7, frame now 1350x560 |
| 23 | `look --no-badges` | `qs` did not follow the shrunken `data` frame up, so there was a ~400px gap |
| 24 | `apply --label "Close gap"` `move qs below=data gap=120` | rev 8. The reply only said `qs rearranged its children (…)`, with no `qs moved (x,y) → (x,y)` line |
| 25 | `read --scope qs --detail full` | confirmed the move. Header said `56 shapes, 0 arrows` |
| 26 | `wait "Evals/Google login" --timeout 600` (background) | round 1 |
| 27 | `read "Evals/Google login"` | full board |
| 28 | `look --scope q5,p1` | pen zig-zag across q5 |
| 29 | `read` (header) | `human: viewing (-450,1120 2230x2000) · selected [q1]` |
| 30 | `look --scope frame:qs --no-badges` | **the pen p1 drawn on q5 is missing from this render** (it is not a child of the frame) |
| 31–32 | `apply --label "Record decisions"`, dry-run then real (frame `decided` d1–d4, reply text r1, `update a3 text=…`) | rev 13 |
| 33 | `look --scope qs,decided,n4,r1,p1 --no-badges` | ok |
| 34 | `wait … --timeout 600` (background) | round 2 |
| 35 | `look --scope q2,p2,n5 --no-badges` | circle around q2 |
| 36 | `read --scope view` | table rows printed **without their parent frame lines** (orphan `\| id \| email \| …` rows). Header `65 shapes, 0 arrows` although arrows are in view |
| 37 | `apply --label "Use Passport" --dry-run` | `problems:` / `- label of a7 (cb -> known) overlaps known — leave more room between the shapes it connects`. I shortened the label |
| 38 | `apply --label "Use Passport"` (d5, text updates on n1–n3/session/a6/a7, reply r2, qs title) | rev 18, problems: none |
| 39 | `look --no-badges` | ok |
| 40 | `wait … --timeout 600` (background) | round 3 |
| 41 | `read --scope n6,a14,known --detail full` | ok |
| 42 | `look --scope n6,known,flow --no-badges` | human sticky above the flow, with an arrow into the diamond |
| 43 | `diagram --frame linking --title "Answer: email_verified decides whether we may link" --direction right --above n6 --gap 60 --spacing compact` | rev 23, problems: none |
| 44 | `look --scope frame:linking` | ok |
| 45–46 | `apply --label "Answer email_verified"`, dry-run then real (text `why` right of n6, d6, qs title) | rev 24 |
| 47 | `look --no-badges` | final check |

## 2. Feedback rounds

### Round 1 (rev 8 → 12)

wait output:
```
- + sticky n4 "Yes, they can add a password later. Forgot password should tell them to use Google." (750,1280 200x200) by=human
- q4 text "Anyone with a Google account, or only your company's domain (hd=yourco.com)?" → "Anyone with a Google account, or only your domain? -> ANYONE, no domain limit."
- + pen p1 (30,1540 250x140) scribbled on q5 by=human
selected now: [q1]
```
- **Enough to understand?** Mostly.
  - The q4 edit was clear on its own.
  - For n4, the text clearly answers q3, but wait didn't say so. I had to compare coordinates: n4 sits 100px right of q3, outside the `qs` frame.
  - "scribbled on q5" told me which sticky the pen was on, but not what it meant. I needed `look --scope q5,p1` to see that it was a zig-zag cross-out. Even then, "crossed out" could mean "not needed" or "wrong", so I wrote my reading on the board and asked them to correct it.
  - `selected now: [q1]` with no other change to q1 was ambiguous. I didn't act on it, and in round 3 it turned out they were about to edit q1.
- **What I changed:**
  - Added a green "Decided so far" frame:
    - d1: anyone can sign in
    - d2: Google-only users can add a password later
    - d3: Forgot password for them says "use Google"
    - d4: login only, no Google tokens, with my interpretation of the scribble stated
  - Added a green "Got it" note under n4.
  - Changed flow arrow 3 to include `scope openid email`.

### Round 2 (rev 13 → 17)

wait output:
```
- + pen p2 (-10,1240 350x250) circles q2 by=human
- + sticky n5 "The circled one: we already use Passport." (750,1640 200x200) by=human
- - text qhow "You can also circle things with the pen, or delete what you don't want."
nothing selected
```
- **Enough to understand?** Yes, from the text alone. "circles q2" plus a sticky saying "the circled one" made it clear. I still ran `look` to confirm. Deleting my hint text needed no action.
- **What I changed:** switched the plan to Passport.
  - Flow labels: 6 "tokens + profile", 7 "profile", session box "req.login(user)".
  - Rewrote the 3 "What to get right" notes: Passport's `state: true`, use `profile.id` as the identity, Passport 0.6+ regenerates the session on login.
  - Added d5 (use passport-google-oauth20) and a reply under n5.
  - Retitled `qs` to "One question left: the top-left one (account linking)".

### Round 3 (rev 18 → 22)

wait output:
```
- + sticky n6 "What if Google says email_verified = false?" (-200,-480 200x200) by=human
- + a14 n6 -> known by=human
- q1 text "…auto-link when Google says email_verified? My pick: yes." → "…auto-link when Google says email_verified? -> YES, auto-link."
selected now: [q1]
```
- **Enough to understand?** Yes. The arrow `n6 -> known` anchored the new question to the "Google ID linked?" diamond, and the q1 edit was clear. The q1 before/after is long, though. Showing only the appended text would be easier to read.
- **What I changed:**
  - Drew a new decision-tree frame (`linking`) above n6: New Google ID → email already a user? → email_verified? → auto-link / log in with password then link (red) / create user / create user + send verify email.
  - Added a green "why" note next to n6 (account-takeover risk; only non-Gmail Google accounts are affected).
  - Added d6 and retitled `qs` to "all answered".
  - I deliberately did **not** re-run `diagram --frame flow` to add the branch inline. Round 0's re-run reported "also removed arrow … (it was attached to flow)", so re-running would probably have deleted the human's arrow a14 into `known`.

## 3. What was confusing or missing (focus: perceiving human edits)

1. **Frame-scoped `look` hides human ink.** `look --scope frame:qs` didn't draw pen p1, even though it lies on q5 inside the frame. Pens aren't frame children, so a natural "show me what they did in frame 3" leaves out exactly the human marks. I only caught it because I had already looked at `q5,p1`.
2. **New stickies aren't tied to anything.** For pens, wait says `circles q2` / `scribbled on q5`, which is excellent. For a new sticky it gives only raw coordinates. n4 (the answer to q3) and n5 (the answer to q2) were both placed in a column right of the frame, not next to their question. Only the wording ("The circled one") let me connect n5; for n4 I had to do coordinate maths.
3. **"scribbled" doesn't separate cross-out from emphasis.** A zig-zag over text almost always means "strike this", but the label only says scribbled. I still needed a PNG and still had to guess the meaning.
4. **Selection is ambiguous.** `selected now: [q1]` appeared in rounds 1 and 3. I couldn't tell whether it was a pointer ("this one") or leftover state. Showing whether the selection *changed* during the round would help.
5. **Human ids look like mine.** Human stickies got ids n4, n5, n6, while my notes were n1–n3. For a moment I couldn't tell whose n4 was; only `by=human` disambiguated.
6. **Board name inconsistency.** The wait header says `the human changed "Google login"` while every other command says `"Evals/Google login"`.
7. **Re-running a diagram is risky and its reply contradicts itself.** The reply lists shapes as "moved" and also "also removed … (inside flow)". Nothing in the skill says whether human arrows attached to diagram nodes survive. There is no `--dry-run` for `diagram` to find out.
8. **Frames grow but don't shrink.** After moving notes up, `data` kept 1640x830. `update data w=` was silently ignored because the frame keeps its x; only `h` applied. The fix needed `at=` (the "last resort") on a child.
9. **Stacked frames don't reflow.** When `data` shrank, `qs` (placed `below=data`) stayed put and left a gap.
10. **Placement surprises in a new free-layout frame.** `dn1 below=users` landed ~280px lower than expected, and the first table sat 320px in from the frame edge. The dry-run cut off with `...and 1 more`, hiding the shape that probably caused it.
11. **`read` header counts and `--scope view` output are confusing.** For a scoped read the header mixes the board shape total with the scoped arrow count (`56 shapes, 0 arrows`). `--scope view` prints table rows without their frame line, so rows appear with no caption.
12. **`move` of a frame doesn't report the move itself**, only "rearranged its children".
13. **Minor:** problems were "none" while arrow a10 ran along a box edge. The dry-run did catch a label overlap (a7), which was useful.

What worked well:
- wait's pen classification ("circles q2", "scribbled on q5").
- `a14 n6 -> known by=human`, which anchored a question to a diagram node.
- Atomic, dry-runnable `apply`.
- Exact `problems:` on label overlaps.
- `update <frame> text=` for retitling.
- The grid frame shrinking after `qhow` was deleted.

## 4. Concrete design changes I'd want

1. **wait: anchor every new human shape.** Use the nearest shape or frame plus the relation, e.g. `+ sticky n4 "…" right of q3 (100px), outside frame qs`. When the text mentions something visual ("the circled one"), link it to that round's pen mark.
2. **wait: attach a picture when ink is involved.** Have wait print a `look:` PNG path scoped to each pen stroke plus its target, so perceiving a pen mark doesn't need another command. Better still, classify more finely: `crossed out q5`, `underlined`, `arrow from X to Y`.
3. **`look --scope frame:X` includes everything intersecting the frame's bounds**, especially human pens and stickies, not just children.
4. **wait: say how the selection changed** (`selection: none → [q1]` or `unchanged [q1]`). For long text edits, show the inserted part only (`q1 text: appended "-> YES, auto-link."`).
5. **Distinct ids for human shapes** (e.g. `h1`, `h-sticky-2`), and always print the folder-qualified board name.
6. **`diagram --dry-run`**, and on re-run, keep arrows from outside the diagram (especially `by=human` ones) by reconnecting them to the node with the same id. The reply should say what it kept, and drop the contradictory "moved" plus "removed" lines.
7. **Frames hug their children**, or there is an explicit `update <frame> fit`. `w=` on a frame should not be silently ignored: report why, or move x.
8. **Keep `below=`/`right-of=` relations between top-level frames live**, or add `libreta reflow`, so shrinking frame 2 pulls frame 3 up.
9. **A "resolved" state for stickies** (e.g. `update q2 done` renders a check, and wait reports when the human ticks one). I had to invent a "Decided" frame and retitle the questions frame to track this.
10. **`read` fixes:** correct scoped counts, and keep parent frame lines in `--scope view`.

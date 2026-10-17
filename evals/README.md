# Evals

How we test the agent interface: a real Claude Code worker (started with Orca orchestration)
uses the `libreta` skill and CLI on a board, while a human, or Claude playing one through the
browser, gives feedback by editing the board. Each worker writes a report of every command it
ran, what confused it, and what it would change. The tool design follows from these reports.

| Date | Scenario | What it tested | What changed afterwards |
|---|---|---|---|
| 2026-10-17 | URL shortener | Explain a system in 4 frames | Board names in every reply, sizing that fits its own text, two-pass placement, `diagram` placement, tables, glyph checks, URL wrapping, bigger frame titles |
| 2026-10-17 | Google login | Plan with the human over 3 rounds of board edits | "Right of q3" hints for new shapes, finer pen reading, `look` crops the area, selection changes, `h1` ids for human shapes, diagrams revised in place, `fit` |

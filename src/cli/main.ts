#!/usr/bin/env node
// The `libreta` command. A thin client: it forwards to the local server (starting it if
// needed) and prints the server's text answer.

import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const PORT = Number(process.env.LIBRETA_PORT ?? 4747)
const BASE = `http://127.0.0.1:${PORT}`
const SERVER = fileURLToPath(new URL('../server/main.ts', import.meta.url))

const HELP = `libreta — a whiteboard you and your AI agent draw on together

boards
  libreta ls                         list folders and boards
  libreta new <name> [--open]        create a board ("Work/Checkout flow" makes the folder too)
  libreta mkdir <folder>             create a folder
  libreta mv <from> <to>             rename or move a board or folder
  libreta rm <name>                  move a board or folder to the trash
  libreta open [board]               show a board in the browser

drawing (board defaults to the one open in the browser)
  libreta changes [board]            what the human changed since you last looked (run it at the start of each turn)
  libreta read [board]               the board as text   --scope all|view|selection|frame:<id>|<id,id>  --detail outline|normal|full
  libreta apply [board] <<'EOF'      apply ops from stdin (line format or JSON)   --label "..."  --dry-run
  libreta diagram [board] <<'EOF'    lay out nodes + arrows automatically         --frame <id> --title "..." --direction right|down
                                     --below|--right|--left|--above <id> [--gap n]  --spacing compact|normal|loose  --size s|m|l|xl  --dry-run
  libreta look [board]               render a PNG and print its path              --scope ...  --no-badges
  libreta wait [board]               block until the human edits (only if asked to watch live)  --timeout <seconds>
  libreta undo [board]               undo your last change (or --rev <n>)
  libreta history [board]            who changed what, newest first              --limit <n>
  libreta guide                      how to draw well with libreta (read this first)

  libreta serve                      run the server in the foreground
options: --agent <name> (default: $LIBRETA_AGENT, else "claude" inside Claude Code, else "agent")`

async function ensureServer(): Promise<void> {
  if (await healthy()) return
  const logDir = join(tmpdir(), 'libreta')
  mkdirSync(logDir, { recursive: true })
  const log = openSync(join(logDir, 'server.log'), 'a')
  spawn(process.execPath, [SERVER], { detached: true, stdio: ['ignore', log, log], env: process.env }).unref()
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200))
    if (await healthy()) return
  }
  fail(`couldn't start the libreta server — see ${join(logDir, 'server.log')}`)
}

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/api/health`)).ok
  } catch {
    return false
  }
}

function fail(message: string): never {
  process.stderr.write(message.endsWith('\n') ? message : message + '\n')
  process.exit(1)
}

async function stdin(): Promise<string> {
  if (process.stdin.isTTY) fail(`pipe ops in, e.g.\n  libreta apply <<'EOF'\n  box api "API"\n  EOF`)
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function request(method: 'GET' | 'POST', path: string, params: Record<string, string | undefined>, body?: string): Promise<Response> {
  await ensureServer()
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined))
  return fetch(`${BASE}${path}?${query}`, { method, body })
}

function print(text: string): void {
  if (text) process.stdout.write(text.endsWith('\n') ? text : text + '\n')
}

async function call(method: 'GET' | 'POST', path: string, params: Record<string, string | undefined>, body?: string): Promise<void> {
  const res = await request(method, path, params, body)
  const text = await res.text()
  if (!res.ok) fail(text)
  print(text)
}

/** `wait` in rounds of up to 4 minutes (the server answers 204 when a round had no changes). */
async function waitForHuman(params: Record<string, string | undefined>, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    const round = Math.max(1, Math.min(240, Math.ceil((deadline - Date.now()) / 1000)))
    const res = await request('GET', '/api/wait', { ...params, timeout: String(round) })
    if (res.status === 204) continue
    const text = await res.text()
    if (!res.ok) fail(text)
    return print(text)
  }
  print(`no changes in ${seconds}s — run libreta wait again to keep waiting`)
}

async function main(): Promise<void> {
  const { values: opt, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      scope: { type: 'string' },
      detail: { type: 'string' },
      label: { type: 'string' },
      'dry-run': { type: 'boolean' },
      direction: { type: 'string' },
      frame: { type: 'string' },
      title: { type: 'string' },
      timeout: { type: 'string' },
      rev: { type: 'string' },
      limit: { type: 'string' },
      below: { type: 'string' },
      right: { type: 'string' },
      left: { type: 'string' },
      above: { type: 'string' },
      gap: { type: 'string' },
      spacing: { type: 'string' },
      size: { type: 'string' },
      'no-badges': { type: 'boolean' },
      open: { type: 'boolean' },
      agent: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command, a, b] = positionals
  // The name history shows for this agent's changes. Claude Code marks its shells with CLAUDECODE=1.
  const agent = opt.agent ?? process.env.LIBRETA_AGENT ?? (process.env.CLAUDECODE ? 'claude' : 'agent')
  const board = a

  if (!command || opt.help || command === 'help') return void console.log(HELP)
  const library = (action: string, body: object) => call('POST', '/api/library', {}, JSON.stringify({ action, ...body }))

  switch (command) {
    case 'serve':
      await import(SERVER)
      return
    case 'ls':
      return call('GET', '/api/library', { format: 'text' })
    case 'new':
      return library('new', { path: a, open: opt.open })
    case 'mkdir':
      return library('mkdir', { path: a })
    case 'mv':
      return library('mv', { path: a, to: b })
    case 'rm':
      return library('rm', { path: a })
    case 'open':
      return call('POST', '/api/open', { board })
    case 'changes':
      return call('GET', '/api/changes', { board, agent })
    case 'read':
      return call('GET', '/api/read', { board, agent, scope: opt.scope, detail: opt.detail })
    case 'apply':
      return call('POST', '/api/apply', { board, agent, label: opt.label, dry: opt['dry-run'] ? '1' : undefined }, await stdin())
    case 'diagram':
      return call('POST', '/api/diagram', {
        board, agent, label: opt.label, direction: opt.direction, frame: opt.frame, title: opt.title, size: opt.size,
        below: opt.below, right: opt.right, left: opt.left, above: opt.above, gap: opt.gap, spacing: opt.spacing,
        dry: opt['dry-run'] ? '1' : undefined,
      }, await stdin())
    case 'look':
      return call('GET', '/api/look', { board, agent, scope: opt.scope, badges: opt['no-badges'] ? '0' : undefined })
    case 'wait':
      return waitForHuman({ board, agent }, Number(opt.timeout ?? 600))
    case 'undo':
      return call('POST', '/api/undo', { board, agent, rev: opt.rev })
    case 'history':
      return call('GET', '/api/history', { board, limit: opt.limit })
    case 'guide':
      return call('GET', '/api/guide', {})
    default:
      fail(`unknown command "${command}"\n\n${HELP}`)
  }
}

main().catch((e) => fail(String(e?.message ?? e)))

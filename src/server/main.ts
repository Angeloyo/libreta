// The Libreta server: one local process that owns the boards. It serves the web app,
// the HTTP API the `libreta` CLI uses, and the WebSocket the browser syncs over.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOps, diagram, guide, history, look, read, roomFor, undo, wait } from './agent.ts'
import { UserError } from './errors.ts'
import { cleanPath, createBoard, createFolder, findBoard, HOME, moveEntry, trashEntry, tree, treeText } from './library.ts'
import { closeRoom, flushAll, renameRoom } from './rooms.ts'
import { broadcastLibrary, handleUpgrade, navigate } from './sockets.ts'

export const PORT = Number(process.env.LIBRETA_PORT ?? 4747)
const WEB_URL = process.env.LIBRETA_WEB_URL ?? `http://localhost:${PORT}`
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIST = join(ROOT, 'dist/web')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const boardUrl = (path: string) => `${WEB_URL}/#/${path.split('/').map(encodeURIComponent).join('/')}`

/** Shows a board to the human: in their open tab if there is one, otherwise a new browser tab. */
function open(path: string): string {
  if (navigate(path)) return `showing "${path}" in the open browser tab`
  spawn('open', [boardUrl(path)], { stdio: 'ignore', detached: true }).unref()
  return `opened ${boardUrl(path)}`
}

function library(action: string, body: { path?: string; to?: string; open?: boolean }): string {
  const need = (v: string | undefined, what: string) => {
    if (!v) throw new UserError(`${action} needs ${what}`)
    return v
  }
  flushAll()
  let text: string
  if (action === 'new') {
    const path = createBoard(need(body.path, 'a board name'))
    text = `created board "${path}"`
    if (body.open) text += `\n${open(path)}`
  } else if (action === 'mkdir') text = `created folder "${createFolder(need(body.path, 'a folder name'))}/"`
  else if (action === 'mv') {
    const moved = moveEntry(need(body.path, 'what to move'), need(body.to, 'where to move it'))
    renameRoom(moved.from, moved.to)
    text = `moved ${moved.type} "${moved.from}" → "${moved.to}"`
  } else if (action === 'rm') {
    const ref = need(body.path, 'what to remove')
    const path = existsSync(join(HOME, cleanPath(ref))) ? cleanPath(ref) : findBoard(ref)
    closeRoom(path)
    const gone = trashEntry(path)
    text = `moved ${gone.type} "${gone.path}" to the trash (${HOME}/.trash)`
  } else throw new UserError(`unknown library action "${action}"`)
  broadcastLibrary()
  return text
}

async function api(req: IncomingMessage, url: URL, res: ServerResponse): Promise<string | object | null> {
  const q = url.searchParams
  const route = `${req.method} ${url.pathname}`
  if (route === 'GET /api/health') return 'libreta ok'
  if (route === 'GET /api/guide') return guide()
  if (route === 'GET /api/library') return q.get('format') === 'text' ? treeText().join('\n') || '(empty library)' : { home: HOME, tree: tree() }
  if (route === 'POST /api/library') {
    const body = JSON.parse((await readBody(req)) || '{}')
    return library(body.action, body)
  }
  if (route === 'POST /api/open') return open(roomFor(q.get('board')).path)
  if (route === 'GET /api/read') return read(roomFor(q.get('board')), q)
  if (route === 'POST /api/apply') return applyOps(roomFor(q.get('board')), q, await readBody(req))
  if (route === 'POST /api/diagram') return diagram(roomFor(q.get('board')), q, await readBody(req))
  if (route === 'GET /api/look') return look(roomFor(q.get('board')), q)
  if (route === 'POST /api/undo') return undo(roomFor(q.get('board')), q)
  if (route === 'GET /api/history') return history(roomFor(q.get('board')), q)
  if (route === 'GET /api/wait') {
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    return wait(roomFor(q.get('board')), q, abort.signal)
  }
  res.statusCode = 404
  return `no such endpoint: ${route}`
}

function serveStatic(url: URL, res: ServerResponse): void {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'content-type': 'text/plain' })
    res.end('The web app is not built yet. Run: npm run build')
    return
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)))
  if (!file.startsWith(DIST) || !existsSync(file) || !extname(file)) file = join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (!url.pathname.startsWith('/api/')) return serveStatic(url, res)
  try {
    const out = await api(req, url, res)
    if (out === null) return void res.writeHead(204).end()
    const json = typeof out !== 'string'
    res.writeHead(res.statusCode, { 'content-type': json ? 'application/json' : 'text/plain; charset=utf-8' })
    res.end(json ? JSON.stringify(out) : out)
  } catch (e) {
    const mistake = e instanceof UserError
    res.writeHead(mistake ? 400 : 500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(mistake ? e.message : `server error: ${(e as Error).stack}`)
  }
})

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/ws')) handleUpgrade(req, socket, head)
  else socket.destroy()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    flushAll()
    process.exit(0)
  })
}

server.listen(PORT, '127.0.0.1', () => console.log(`libreta server on http://localhost:${PORT} · boards in ${HOME}`))

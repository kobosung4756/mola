import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Connect, Plugin } from 'vite'
import { autoExit } from './auto-exit.ts'
import { localData } from './local-data.ts'

const MAX_BYTES = 80 * 1024 * 1024
// Papers (PDF, arXiv Atom), link previews (web pages, oEmbed JSON, thumbnail images).
const ALLOWED_TYPES = /application\/pdf|application\/atom\+xml|application\/xml|text\/xml|application\/octet-stream|text\/html|application\/xhtml\+xml|application\/json|image\//i

/**
 * Local-only fetch relay for paper PDFs, arXiv metadata and link previews, for hosts that do not
 * send CORS headers. It runs inside this machine's dev/preview server, answers only same-origin
 * requests to 127.0.0.1/localhost, and only passes through PDF, Atom/XML, HTML, JSON and image
 * responses up to 80 MB. The app only parses what comes back; it never runs fetched pages.
 */
function paperProxy(): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith('/api/fetch')) return next()
    // Marks every answer as coming from this relay (the app tells it apart from a plain page).
    res.setHeader('x-board-relay', '1')
    // Upstream and validation failures go back as 200 with an error header, so a dead link the app
    // merely tries to preview does not show up as a failed request in the browser console. The
    // local-only and same-origin refusals keep real error statuses.
    const fail = (status: number, msg: string) => {
      const soft = status !== 403
      if (soft) res.setHeader('x-board-relay-error', String(status))
      res.statusCode = soft ? 200 : status
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end(msg)
    }
    const host = (req.headers.host ?? '').split(':')[0]
    if (host !== '127.0.0.1' && host !== 'localhost') return fail(403, 'local requests only')
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
      return fail(403, 'same-origin requests only')
    }
    let target: URL
    try {
      target = new URL(new URL(req.url, 'http://local').searchParams.get('url') ?? '')
    } catch {
      return fail(400, 'invalid url')
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return fail(400, 'http(s) only')
    try {
      const upstream = await fetch(target, {
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; molanote/1.0; link preview)',
          accept: 'text/html, application/pdf, application/atom+xml, application/json, image/*, */*;q=0.5',
        },
        signal: AbortSignal.timeout(45_000),
      })
      if (!upstream.ok) return fail(502, `upstream ${upstream.status}`)
      const type = upstream.headers.get('content-type') ?? ''
      if (!ALLOWED_TYPES.test(type)) return fail(415, `not a paper: ${type || 'unknown type'}`)
      const declared = Number(upstream.headers.get('content-length') ?? 0)
      if (declared > MAX_BYTES) return fail(413, 'file too large')
      const body = Buffer.from(await upstream.arrayBuffer())
      if (body.length > MAX_BYTES) return fail(413, 'file too large')
      res.statusCode = 200
      res.setHeader('content-type', type)
      res.setHeader('cache-control', 'no-store')
      res.end(body)
    } catch (err) {
      fail(502, (err as Error).message)
    }
  }
  return {
    name: 'paper-proxy',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

// Without the launcher, boards live in the browser's IndexedDB, which is tied to the exact address
// and port; fixed ports keep the same data every time. With it, they live in the data folder (local-data.ts).
export default defineConfig({
  plugins: [react(), paperProxy(), autoExit(), localData()],
  // Supabase's Connect dialog may show Next.js-style names (NEXT_PUBLIC_...); accept those too.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})

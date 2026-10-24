import type { Plugin } from 'vite'

/** How long a page may go without a ping before it counts as gone (background tabs ping at most once a minute). */
const STALE_MS = 3 * 60_000
/** Grace period after the last page closes, so a reload does not stop the server. */
const GRACE_MS = 8_000

/**
 * For the double-click launcher (scripts/launch.mjs): the preview server stops by itself once
 * every tab of the app has been closed. Open pages ping /__board_alive; a closing page says goodbye.
 * Only active when BOARD_AUTO_EXIT=1, so `npm start` and the tests behave as before.
 */
export function autoExit(): Plugin {
  return {
    name: 'board-auto-exit',
    configurePreviewServer(server) {
      if (process.env.BOARD_AUTO_EXIT !== '1') return
      const pages = new Map<string, number>()
      let seen = false
      let emptySince = 0
      server.middlewares.use('/__board_alive', (req, res) => {
        const q = new URL(req.url ?? '', 'http://local').searchParams
        const id = q.get('id')
        if (id && q.has('bye')) pages.delete(id)
        else if (id) {
          pages.set(id, Date.now())
          seen = true
        }
        res.setHeader('cache-control', 'no-store')
        res.end('ok')
      })
      setInterval(() => {
        const now = Date.now()
        for (const [id, t] of pages) if (now - t > STALE_MS) pages.delete(id)
        if (!seen || pages.size) {
          emptySince = 0
          return
        }
        if (!emptySince) emptySince = now
        else if (now - emptySince >= GRACE_MS) {
          console.log('molanote: every tab is closed, stopping.')
          process.exit(0)
        }
      }, 1000)
    },
  }
}

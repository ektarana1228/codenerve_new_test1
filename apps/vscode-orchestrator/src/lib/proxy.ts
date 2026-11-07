import type { Server } from 'http'
import type { Socket } from 'net'
import httpProxy from 'http-proxy'
import type { Logger } from '@platform/logger'
import type { Manager } from './manager'
import { tokenFromCookie, verifyProxyToken } from './token'

// Reverse-proxies browser traffic (HTTP + WebSocket) for /vscode/<id>/* to that
// session's openvscode-server container. WebSockets are essential - VS Code runs
// its entire protocol over one. Access is gated by the session-scoped `tkn`.

function extractSessionId(url: string): string | null {
  const match = url.match(/^\/vscode\/([0-9a-fA-F-]{36})(?:\/|$|\?)/)
  return match ? match[1] : null
}

function extractToken(url: string): string | null {
  const q = url.indexOf('?')
  if (q === -1) return null
  return new URLSearchParams(url.slice(q + 1)).get('tkn')
}

export function attachProxy(server: Server, manager: Manager, secret: string, log: Logger): void {
  const proxy = httpProxy.createProxyServer({ changeOrigin: true, ws: true })

  proxy.on('error', (err, _req, res) => {
    log.warn({ err: err.message }, 'proxy error')
    // res may be a ServerResponse (HTTP) or a Socket (WS upgrade).
    const socketLike = res as Partial<Socket>
    if (typeof (res as { writeHead?: unknown }).writeHead === 'function') {
      const httpRes = res as unknown as { writeHead: (n: number) => void; end: (s?: string) => void }
      httpRes.writeHead(502)
      httpRes.end('VS Code backend unavailable')
    } else if (socketLike.destroy) {
      socketLike.destroy()
    }
  })

  // WebSocket upgrades bypass Fastify routing - handle them on the raw server.
  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''
    const sessionId = extractSessionId(url)
    if (!sessionId) return // not ours - let other upgrade handlers deal with it
    // The browser sends the proxy cookie on the WS handshake; fall back to the query.
    const token = tokenFromCookie(req.headers.cookie) ?? extractToken(url)
    if (!token || verifyProxyToken(token, secret) !== sessionId) {
      socket.destroy()
      return
    }
    const target = manager.getTarget(sessionId)
    if (!target || target.mode !== 'docker') {
      socket.destroy()
      return
    }
    proxy.ws(req, socket, head, { target: `http://${target.host}:${target.port}` })
  })
}

// Proxies a single hijacked HTTP request/response pair to the container.
export function proxyHttp(
  manager: Manager,
  secret: string,
  sessionId: string,
  token: string,
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
): boolean {
  if (verifyProxyToken(token, secret) !== sessionId) {
    res.writeHead(401)
    res.end('invalid token')
    return true
  }
  const target = manager.getTarget(sessionId)
  if (!target || target.mode !== 'docker') return false
  const proxy = httpProxy.createProxyServer({ changeOrigin: true })
  proxy.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end('VS Code backend unavailable')
  })
  proxy.web(req, res, { target: `http://${target.host}:${target.port}` })
  return true
}

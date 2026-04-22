import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { handleMcpRequest, type PublicMcpDeps } from '../control-plane/mcp/public-mcp';

/**
 * SSE MCP transport — MCP 2024-11-05 HTTP+SSE spec.
 *
 * Two endpoints:
 *   GET  /mcp/sse               Client opens a persistent SSE stream. Server
 *                               sends an "endpoint" event with the POST URL.
 *   POST /mcp/messages          Client sends JSON-RPC requests. Responses are
 *                               pushed back on the matching SSE stream.
 *
 * Session correlation: the server assigns a sessionId on SSE connect and
 * embeds it in the endpoint URL. The client includes it as ?sessionId=<id>
 * on every POST. An in-process Map holds the push functions — no Redis needed.
 *
 * Claude Desktop MCP config:
 *   {
 *     "mcpServers": {
 *       "praxis": {
 *         "transport": "sse",
 *         "url": "http://<host>/mcp/sse"
 *       }
 *     }
 *   }
 */

// sessionId → function that pushes a JSON-RPC response onto the SSE stream
const sessions = new Map<string, (data: string) => Promise<void>>();

export function publicMcpRoutes(app: Hono, deps: PublicMcpDeps): void {
  /**
   * GET /mcp/sse
   *
   * Opens the SSE channel. Immediately sends:
   *   event: endpoint
   *   data: <base-url>/mcp/messages?sessionId=<id>
   *
   * Then pings every 20s to keep the connection alive through proxies.
   * Cleans up the session map on disconnect.
   */
  app.get('/mcp/sse', async (c) => {
    const sessionId = randomUUID();

    return streamSSE(c, async (sse) => {
      sessions.set(sessionId, (data) => sse.writeSSE({ event: 'message', data }));

      const origin = new URL(c.req.url).origin;
      await sse.writeSSE({
        event: 'endpoint',
        data: `${origin}/mcp/messages?sessionId=${sessionId}`,
      });

      const ping = setInterval(() => {
        sse.writeSSE({ event: 'ping', data: '' }).catch(() => {});
      }, 20_000);

      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(ping);
          sessions.delete(sessionId);
          resolve();
        });
      });
    });
  });

  /**
   * POST /mcp/messages?sessionId=<id>
   *
   * Receives a JSON-RPC request, dispatches to the tool handler, and pushes
   * the response back on the SSE stream identified by sessionId.
   *
   * Returns HTTP 202 with an empty body — the actual response travels over SSE.
   */
  app.post('/mcp/messages', async (c) => {
    const sessionId = c.req.query('sessionId');
    if (!sessionId) {
      return c.json({ error: 'missing sessionId' }, 400);
    }

    const push = sessions.get(sessionId);
    if (!push) {
      return c.json({ error: 'unknown or expired session' }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const response = await handleMcpRequest(body, deps);
    await push(JSON.stringify(response));

    return c.body(null, 202);
  });
}

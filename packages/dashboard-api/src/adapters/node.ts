/**
 * @module @conveyor/dashboard-api/adapters/node
 *
 * Adapter to convert a Web Standard `(Request) => Response` handler
 * into a Node.js `(IncomingMessage, ServerResponse) => void` handler.
 * Streams the response body chunk-by-chunk for SSE support.
 */

import type { DashboardHandler } from '../types.ts';

/**
 * Convert a Web Standard handler into a Node.js-compatible handler.
 * Works with Express, Fastify, Koa, NestJS, AdonisJS, etc.
 *
 * Critical: streams the response body chunk-by-chunk (not buffered)
 * so that SSE events are delivered in real-time.
 *
 * @param handler - The dashboard handler.
 * @returns A Node.js request handler.
 */
export function toNodeHandler(
  handler: DashboardHandler,
): (req: unknown, res: unknown) => void {
  return async (incomingMessage: unknown, serverResponse: unknown) => {
    const req = incomingMessage as {
      method: string;
      url: string;
      headers: Record<string, string | string[] | undefined>;
      socket?: { encrypted?: boolean };
      on(event: string, cb: (chunk: unknown) => void): void;
    };
    const res = serverResponse as {
      writeHead(status: number, headers: Record<string, string>): void;
      write(chunk: unknown): boolean;
      end(data?: unknown): void;
      on(event: string, cb: () => void): void;
    };

    try {
      // Build the Request object
      const protocol = req.socket?.encrypted ? 'https' : 'http';
      const host = (req.headers.host as string) ?? 'localhost';
      const url = new URL(req.url ?? '/', `${protocol}://${host}`);

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }

      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const body = hasBody
        ? new ReadableStream({
          start(controller) {
            req.on('data', (chunk: unknown) => controller.enqueue(chunk));
            req.on('end', () => controller.close());
            req.on('error', (err: unknown) => controller.error(err));
          },
        })
        : undefined;

      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body,
        // @ts-ignore: duplex needed for streaming body in Node
        duplex: hasBody ? 'half' : undefined,
      });

      const response = await handler(request);

      // Write response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      res.writeHead(response.status, responseHeaders);

      // Stream response body chunk-by-chunk (critical for SSE)
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch {
          // Client disconnected
        } finally {
          reader.releaseLock();
        }
      }

      res.end();
    } catch {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }),
      );
    }
  };
}

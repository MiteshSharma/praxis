import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod';
import { contract } from '@shared/contracts';
import type { Hono } from 'hono';
import { env } from '../lib/env';

/**
 * Registers `/openapi.json` and `/docs`.
 *
 * The spec is built in two layers:
 *  1. oRPC auto-generates all RPC procedure paths from the Zod schemas in
 *     `@shared/contracts`. No manual work needed for new oRPC procedures.
 *  2. Non-RPC paths (SSE, health) are defined once here from their DTO schemas
 *     and merged into the same spec object.
 */
export async function registerOpenApi(app: Hono): Promise<void> {
  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  app.get('/openapi.json', async (c) => {
    const rpcSpec = await generator.generate(contract, {
      info: {
        title: 'Praxis API',
        version: process.env.APP_VERSION ?? 'dev',
        description: 'Auto-generated from the oRPC contract in @shared/contracts',
      },
      servers: [
        { url: `http://localhost:${env.PORT}/rpc`, description: 'RPC routes' },
        { url: `http://localhost:${env.PORT}`, description: 'Non-RPC routes' },
      ],
    });

    // Merge non-RPC paths defined from their Zod DTO schemas
    const spec = {
      ...rpcSpec,
      paths: {
        ...(rpcSpec.paths ?? {}),
        ...nonRpcPaths,
      },
    };

    return c.json(spec);
  });

  app.get('/docs', (c) =>
    c.html(`<!doctype html>
<html>
  <head><title>Praxis API</title><meta charset="utf-8"/></head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`),
  );
}

/**
 * OpenAPI path definitions for non-oRPC routes.
 * Each entry is derived from the corresponding DTO schema in `src/dto/`.
 *
 * Keep in sync with the actual routes in `src/routes/`.
 */
const nonRpcPaths = {
  '/health': {
    get: {
      tags: ['System'],
      summary: 'Liveness probe',
      operationId: 'health',
      responses: {
        '200': {
          description: 'Service is alive',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status', 'service', 'role', 'time'],
                properties: {
                  status: { type: 'string', enum: ['ok'] },
                  service: { type: 'string', example: 'backend' },
                  role: { type: 'string', example: 'control-plane' },
                  time: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/ready': {
    get: {
      tags: ['System'],
      summary: 'Readiness probe',
      operationId: 'ready',
      responses: {
        '200': {
          description: 'Service is ready to accept traffic',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status', 'service', 'role', 'time'],
                properties: {
                  status: { type: 'string', enum: ['ok'] },
                  service: { type: 'string', example: 'backend' },
                  role: { type: 'string', example: 'control-plane' },
                  time: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/sse/jobs/{id}': {
    get: {
      tags: ['Jobs'],
      summary: 'Stream live job events',
      description:
        'Opens a Server-Sent Events stream for the given job. ' +
        'Send `Last-Event-ID` header to resume from a specific position.',
      operationId: 'sseJobStream',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Job ID',
          schema: { type: 'string', minLength: 1 },
        },
        {
          name: 'Last-Event-ID',
          in: 'header',
          required: false,
          description: 'Resume stream from this event ID',
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description: 'SSE stream of job events',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                description: 'Newline-delimited SSE frames with JSON data payloads',
              },
            },
          },
        },
        '400': {
          description: 'Missing or invalid job id',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                  details: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

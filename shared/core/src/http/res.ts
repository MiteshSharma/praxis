export const res = {
  json(statusOrBody: unknown, maybeBody?: unknown): Response {
    const [status, body] =
      typeof statusOrBody === 'number'
        ? [statusOrBody, maybeBody]
        : [200, statusOrBody];

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

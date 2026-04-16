export const res = {
  json(statusOrBody: number | unknown, body?: unknown): Response {
    const [status, data] =
      typeof statusOrBody === 'number'
        ? [statusOrBody, body]
        : [200, statusOrBody];

    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

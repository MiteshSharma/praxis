type JsonBody = unknown;

function json(body: JsonBody): Response;
function json(status: number, body: JsonBody): Response;
function json(statusOrBody: number | JsonBody, body?: JsonBody): Response {
  const [status, data] =
    typeof statusOrBody === "number"
      ? [statusOrBody, body]
      : [200, statusOrBody];

  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const res = { json };

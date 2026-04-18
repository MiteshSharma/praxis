/**
 * Parses an SSE (Server-Sent Events) response body and yields each data payload.
 * Each yielded string is the content after "data: " for a single event frame.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic stream frame split
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6));
        if (dataLines.length === 0) continue;
        yield dataLines.join('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

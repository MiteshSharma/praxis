import { describe, expect, it } from 'vitest';
import { parseSSE } from './sse';

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const results: string[] = [];
  for await (const chunk of parseSSE(stream)) {
    results.push(chunk);
  }
  return results;
}

describe('parseSSE', () => {
  it('yields a single event from a well-formed frame', async () => {
    const stream = makeStream(['data: hello\n\n']);
    expect(await collect(stream)).toEqual(['hello']);
  });

  it('yields multiple events from multiple frames', async () => {
    const stream = makeStream(['data: first\n\ndata: second\n\n']);
    expect(await collect(stream)).toEqual(['first', 'second']);
  });

  it('handles frames split across chunks', async () => {
    const stream = makeStream(['data: hel', 'lo\n\n']);
    expect(await collect(stream)).toEqual(['hello']);
  });

  it('ignores non-data lines within a frame', async () => {
    const stream = makeStream(['event: update\ndata: payload\n\n']);
    expect(await collect(stream)).toEqual(['payload']);
  });

  it('joins multiple data lines within one frame', async () => {
    const stream = makeStream(['data: line1\ndata: line2\n\n']);
    expect(await collect(stream)).toEqual(['line1\nline2']);
  });

  it('yields nothing for an empty stream', async () => {
    const stream = makeStream([]);
    expect(await collect(stream)).toEqual([]);
  });

  it('skips keep-alive frames with no data lines', async () => {
    const stream = makeStream([': keep-alive\n\ndata: real\n\n']);
    expect(await collect(stream)).toEqual(['real']);
  });

  it('parses JSON payload correctly', async () => {
    const payload = JSON.stringify({ type: 'result', result: 'done' });
    const stream = makeStream([`data: ${payload}\n\n`]);
    const [raw] = await collect(stream);
    expect(JSON.parse(raw)).toEqual({ type: 'result', result: 'done' });
  });
});

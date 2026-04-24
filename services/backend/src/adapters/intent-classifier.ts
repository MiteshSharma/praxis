export type MessageIntent =
  | { kind: 'submit_job'; task: string }
  | { kind: 'status_query' }
  | { kind: 'approval'; approved: boolean; feedback?: string }
  | { kind: 'unknown' };

const SYSTEM_PROMPT = `You classify user messages sent to a coding agent bot.

Return ONLY a JSON object with this shape (no markdown, no explanation):
{"kind":"submit_job","task":"<rewritten task>"}
{"kind":"status_query"}
{"kind":"approval","approved":true,"feedback":"<optional text>"}
{"kind":"approval","approved":false,"feedback":"<rejection reason>"}
{"kind":"unknown"}

Rules:
- submit_job: user wants to start a coding task. Rewrite "task" as a clear imperative.
- status_query: user is asking about progress, what's happening, status, etc.
- approval: user is approving or rejecting a plan. approved=true for "yes/looks good/approve/go ahead", approved=false for "no/reject/stop/cancel".
- unknown: anything else (greetings, irrelevant, unclear).`;

/**
 * Classify the intent of an incoming message using a single-turn LLM call.
 * Falls back to { kind: 'unknown' } on any error.
 */
export async function classifyIntent(
  text: string,
  model: string,
  apiKey: string,
): Promise<MessageIntent> {
  if (!apiKey) return { kind: 'unknown' };
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) return { kind: 'unknown' };
    const data = (await response.json()) as { content?: Array<{ type: string; text: string }> };
    const block = data.content?.[0];
    if (block?.type !== 'text') return { kind: 'unknown' };

    const parsed = JSON.parse(block.text.trim());
    const kind = parsed.kind as string;

    if (kind === 'submit_job' && typeof parsed.task === 'string') {
      return { kind: 'submit_job', task: parsed.task };
    }
    if (kind === 'status_query') {
      return { kind: 'status_query' };
    }
    if (kind === 'approval' && typeof parsed.approved === 'boolean') {
      return {
        kind: 'approval',
        approved: parsed.approved,
        feedback: parsed.feedback ?? undefined,
      };
    }
    return { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

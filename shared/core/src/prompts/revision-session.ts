import type { Plan } from '../task-tracker/task-tracker';

interface RevisionContext {
  previousPlan: Plan;
  answers?: Record<string, string>;
  additionalFeedback?: string;
}

function formatAnswers(
  answers: Record<string, string>,
  openQuestions?: Array<{ id: string; question: string }>,
): string {
  const entries = Object.entries(answers);
  if (entries.length === 0) return '(no answers provided)';
  return entries
    .map(([id, answer]) => {
      const q = openQuestions?.find((oq) => oq.id === id);
      const label = q ? q.question : id;
      return `Q: ${label}\nA: ${answer}`;
    })
    .join('\n\n');
}

/**
 * System prompt for the revision phase. The previous plan plus user
 * answers/feedback are injected so the agent can produce an improved plan.
 */
export function buildRevisionSystemPrompt(ctx: RevisionContext): string {
  const data = ctx.previousPlan.data as {
    bodyMarkdown?: string;
    openQuestions?: Array<{ id: string; question: string }>;
  };

  const answersSection = ctx.answers
    ? formatAnswers(ctx.answers, data.openQuestions)
    : '(no answers provided)';

  const feedbackSection = ctx.additionalFeedback
    ? `Additional feedback from user:\n${ctx.additionalFeedback}`
    : '';

  return `\
You are revising a plan that the user requested changes on. Your job is
to call submit_plan with an improved version.

--- PREVIOUS PLAN (v${ctx.previousPlan.version}) ---
${data.bodyMarkdown ?? '(plan body unavailable)'}
--- END PREVIOUS PLAN ---

Open questions the user has now answered:
${answersSection}

${feedbackSection}

Produce a revised plan that incorporates the answers and feedback.
At the top of bodyMarkdown, include a short "What changed" section
explaining the differences from the previous plan.
Keep whatever parts of the previous plan are still valid.
If new open questions arise, include them in openQuestions.
`;
}

import matter from 'gray-matter';
import { z } from 'zod';
import {
  AgentDefinitionSchema,
  DefinitionSchema,
  WorkflowDefinitionSchema,
  type Definition,
} from './types';

/**
 * Parses a markdown file that starts with YAML frontmatter.
 * The `kind` field in frontmatter discriminates between agent and workflow files.
 *
 * @throws ZodError when the frontmatter doesn't match the expected schema
 * @throws Error when the frontmatter cannot be parsed
 */
export function parseMarkdown(content: string): { definition: Definition; bodyMarkdown: string } {
  const { data, content: body } = matter(content);

  // Normalize: flatten agent/workflow fields from frontmatter into the expected shape
  const normalized = normalizeDoc(data);

  const definition = DefinitionSchema.parse(normalized);
  return { definition, bodyMarkdown: body.trim() };
}

function normalizeDoc(data: Record<string, unknown>): unknown {
  const kind = data.kind;

  if (kind === 'agent') {
    return {
      kind: 'agent',
      name: data.name,
      description: data.description ?? '',
      version: data.version ?? '1.0.0',
      agent: AgentDefinitionSchema.parse({
        model: data.model,
        systemPrompt: data.systemPrompt,
        allowedTools: data.allowedTools ?? [],
      }),
    };
  }

  if (kind === 'workflow') {
    return {
      kind: 'workflow',
      name: data.name,
      description: data.description ?? '',
      version: data.version ?? '1.0.0',
      workflow: WorkflowDefinitionSchema.parse({
        inputs: data.inputs,
        steps: data.steps,
      }),
    };
  }

  throw new z.ZodError([
    {
      code: 'invalid_literal',
      expected: 'agent or workflow',
      received: String(kind),
      path: ['kind'],
      message: 'kind must be "agent" or "workflow"',
    },
  ]);
}

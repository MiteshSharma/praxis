import { ToolRegistry } from './registry.js';
import {
  readFileTool,
  globTool,
  grepTool,
  writeFileTool,
  editFileTool,
  bashTool,
  submitPlanTool,
  queryMemoryTool,
} from './definitions.js';

export const toolRegistry = new ToolRegistry();

toolRegistry.register(readFileTool);
toolRegistry.register(globTool);
toolRegistry.register(grepTool);
toolRegistry.register(writeFileTool);
toolRegistry.register(editFileTool);
toolRegistry.register(bashTool);
toolRegistry.register(submitPlanTool);
toolRegistry.register(queryMemoryTool);

export type { Tool, ToolContext, ToolTag } from './definitions.js';
export type { Phase } from './registry.js';

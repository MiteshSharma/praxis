import {
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  queryMemoryTool,
  readFileTool,
  submitPlanTool,
  writeFileTool,
} from './definitions.js';
import { ToolRegistry } from './registry.js';

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

import { z } from 'zod';

export const FleetStatusSchema = z.enum([
  'draft',
  'running',
  'scouting',
  'planning',
  'implementing',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export const FleetJobStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'completed',
  'noop',
  'failed',
  'cancelled',
]);
export const FleetJobTypeSchema = z.enum(['scout', 'implement', 'verify']);

export const FleetSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  goal: z.string(),
  mode: z.enum(['fanout', 'orchestrated']),
  status: FleetStatusSchema,
  autoApprove: z.boolean(),
  maxParallel: z.number().int(),
  totalJobs: z.number().int(),
  completedJobs: z.number().int(),
  noopJobs: z.number().int(),
  failedJobs: z.number().int(),
  runningJobs: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const FleetJobSchema = z.object({
  id: z.string().uuid(),
  fleetId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sessionTitle: z.string(),
  sessionMessageId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),       // Praxis job ID — null until message creates the job
  jobStatus: z.string().nullable(),           // fine-grained Praxis job status (e.g. 'executing')
  currentStep: z.string().nullable(),         // e.g. 'execute (2/3)'
  jobType: FleetJobTypeSchema,
  task: z.string(),
  wave: z.number().int(),
  status: FleetJobStatusSchema,
  report: z.record(z.unknown()).nullable(),
  dependsOn: z.array(z.string().uuid()),
  noChanges: z.boolean(),
  prUrl: z.string().nullable(),
  retryCount: z.number().int(),
  merged: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const FleetGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().uuid(),
      sessionId: z.string().uuid(),
      sessionTitle: z.string().nullable(),
      jobType: FleetJobTypeSchema,
      status: FleetJobStatusSchema,
      jobId: z.string().uuid().nullable(),
      jobStatus: z.string().nullable(),
      currentStep: z.string().nullable(),
      wave: z.number().int(),
      noChanges: z.boolean(),
      prUrl: z.string().nullable(),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      from: z.string().uuid(),
      to: z.string().uuid(),
      satisfied: z.boolean(),
    }),
  ),
});

export type FleetDto = z.infer<typeof FleetSchema>;
export type FleetJobDto = z.infer<typeof FleetJobSchema>;
export type FleetGraphDto = z.infer<typeof FleetGraphSchema>;

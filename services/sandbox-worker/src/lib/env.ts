export const env = {
  PORT: Number(process.env.SANDBOX_WORKER_PORT ?? 8787),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
};

import pino, { type Logger } from 'pino';

export function createLogger(service: string): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service,
      env: process.env.NODE_ENV ?? 'development',
      version: process.env.APP_VERSION ?? 'dev',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: ['req.headers.authorization', '*.password', '*.apiKey', '*.token'],
      censor: '[REDACTED]',
    },
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });
}

export function withRequestId(logger: Logger, requestId: string): Logger {
  return logger.child({ requestId });
}

export type { Logger };

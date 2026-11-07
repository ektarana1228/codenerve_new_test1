import pino from 'pino'

export type Logger = pino.Logger

/**
 * Creates a Pino logger bound to a specific service name.
 * Every log line includes { service } so logs from multiple services
 * can be distinguished when aggregated.
 *
 * Production: JSON output to stdout.
 * Development: pino-pretty for human-readable terminal output.
 */
export function createLogger(service: string): Logger {
  const isDev = process.env.NODE_ENV !== 'production'

  const base: pino.LoggerOptions = {
    level: isDev ? 'debug' : 'info',
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
  }

  if (isDev) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          messageKey: 'msg',
        },
      },
    })
  }

  return pino(base)
}

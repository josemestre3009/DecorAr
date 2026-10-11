import "server-only";

import type { Clock, Logger } from "../../shared/application/ports";
import { sanitizeLogContext } from "../../shared/application/sanitize-log-context";

type Level = "debug" | "info" | "warn" | "error";

const WRITERS: Record<Level, (line: string) => void> = {
  debug: (line) => console.debug(line),
  error: (line) => console.error(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
};

/**
 * Server-only JSON logger (DECOR-31). Every line carries `timestamp`,
 * `level`, `message` and a sanitized context, so `component`, `eventId`,
 * `correlationId`, `packageId` and `attempt` are visible while tokens,
 * cookies, keys, passwords, full emails and raw event payloads never are
 * (`sanitizeLogContext` runs on every call, unconditionally).
 */
export function createJsonLogger(clock: Clock): Logger {
  const write = (level: Level, message: string, context?: Readonly<Record<string, unknown>>) => {
    const line = JSON.stringify({
      context: sanitizeLogContext(context),
      level,
      message,
      timestamp: clock.now().toISOString(),
    });

    WRITERS[level](line);
  };

  return {
    debug: (message, context) => write("debug", message, context),
    error: (message, context) => write("error", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
  };
}

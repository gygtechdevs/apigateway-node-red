import type { JsonObject } from './types';

export function logInfo(event: string, data: JsonObject = {}): void {
  console.log(`[gateway] ${event}`, data);
}

export function logError(event: string, error: unknown, data: JsonObject = {}): void {
  const normalizedError =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };

  console.error(`[gateway] ${event}`, { ...data, error: normalizedError });
}

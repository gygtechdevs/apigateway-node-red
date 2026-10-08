import type { IGraphClient, GraphSendResult } from '../../application/ports/IGraphClient';
import { logError } from '../../shared/logger';

export interface MetaGraphClientOptions {
  accessToken: string;
  apiVersion: string;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const GRAPH_BASE_URL = 'https://graph.facebook.com';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export class MetaGraphClient implements IGraphClient {
  private readonly accessToken: string;
  private readonly version: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: MetaGraphClientOptions) {
    this.accessToken = options.accessToken;
    // Accept both "v21.0" and "21.0".
    this.version = `v${options.apiVersion.replace(/^v/i, '')}`;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 300;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async send(phoneNumberId: string, payload: Record<string, unknown>): Promise<GraphSendResult> {
    const url = `${GRAPH_BASE_URL}/${this.version}/${phoneNumberId}/messages`;
    let last: GraphSendResult = { ok: false, status: 0, data: null };

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.baseDelayMs * 2 ** (attempt - 1));

      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();
        let data: unknown = null;
        if (text) {
          try {
            data = JSON.parse(text) as unknown;
          } catch {
            data = { rawText: text };
          }
        }

        last = { ok: response.ok, status: response.status, data };
        if (response.ok || !isRetryable(response.status)) return last;
      } catch (error) {
        logError('meta_graph.request_failed', error, { attempt });
        last = { ok: false, status: 0, data: null };
      }
    }

    return last;
  }
}

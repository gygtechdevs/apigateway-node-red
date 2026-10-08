import type {
  INodeRedClient,
  NodeRedCallOptions,
  NodeRedCallResult,
} from '../../application/ports/INodeRedClient';

export function buildNodeRedUrl(baseUrl: string | undefined, stepPath: string): string {
  if (!baseUrl || !String(baseUrl).trim()) {
    throw new Error('NODE_RED_BASE_URL is required');
  }

  const base = String(baseUrl).replace(/\/$/, '');

  if (/^https?:\/\//i.test(stepPath)) {
    return stepPath;
  }

  const normalizedPath = String(stepPath || '').startsWith('/')
    ? String(stepPath).slice(1)
    : String(stepPath || '');

  return `${base}/${normalizedPath}`;
}

export interface NodeRedClientAdapterOptions {
  /** Defaults to NODE_RED_BASE_URL. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class NodeRedClientAdapter implements INodeRedClient {
  constructor(private readonly options: NodeRedClientAdapterOptions = {}) {}

  async post(
    stepPath: string,
    payload: Record<string, unknown>,
    options?: NodeRedCallOptions,
  ): Promise<NodeRedCallResult> {
    const url = buildNodeRedUrl(this.options.baseUrl ?? process.env.NODE_RED_BASE_URL, stepPath);
    const timeout = options?.timeoutMs ?? (Number(process.env.NODE_RED_TIMEOUT_MS) || 10000);

    let response: globalThis.Response;

    try {
      response = await (this.options.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to invoke Node-RED at ${url}: ${detail}`);
    }

    const rawText = await response.text();
    let data: unknown = null;

    if (rawText) {
      try {
        data = JSON.parse(rawText) as unknown;
      } catch {
        data = { rawText };
      }
    }

    return { ok: response.ok, status: response.status, data, rawText };
  }
}

import type {
  CatalogIntent,
  CreateIntentInput,
  DetectedIntent,
  IIntentsServiceClient,
  IntentsAdminResult,
  UpdateIntentInput,
} from '../../application/ports/IIntentsServiceClient';

export interface IntentsServiceClientOptions {
  baseUrl: string;
  /** Shared secret for the service-to-service endpoints (/intents/detect, /internal/intents). */
  internalSecret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ServiceIntent {
  name: string;
  keywords: string[];
  initialStep: string;
  description?: string;
}

interface ServiceDetection {
  intent: string | null;
  initialStep: string | null;
  confidence: number;
  matchedKeywords: string[];
}

const DEFAULT_TIMEOUT_MS = 5000;

function toCatalogIntent(row: ServiceIntent): CatalogIntent {
  return {
    intent: row.name,
    initialStep: row.initialStep,
    keywords: row.keywords,
    ...(row.description ? { description: row.description } : {}),
  };
}

/**
 * Driven adapter for intents-service. Detection and the catalog listing use the
 * internal secret; catalog writes forward the caller's JWT so intents-service
 * enforces WRITE/ADMIN itself.
 */
export class IntentsServiceClient implements IIntentsServiceClient {
  private readonly baseUrl: string;
  private readonly internalSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IntentsServiceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalSecret = options.internalSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Builds the client from INTENTS_SERVICE_URL / INTENTS_INTERNAL_SECRET. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): IntentsServiceClient {
    const baseUrl = env.INTENTS_SERVICE_URL;
    const internalSecret = env.INTENTS_INTERNAL_SECRET;
    if (!baseUrl || !internalSecret) {
      throw new Error('INTENTS_SERVICE_URL and INTENTS_INTERNAL_SECRET are required');
    }
    return new IntentsServiceClient({
      baseUrl,
      internalSecret,
      ...(env.INTENTS_TIMEOUT_MS ? { timeoutMs: Number(env.INTENTS_TIMEOUT_MS) } : {}),
    });
  }

  async detect(text: string): Promise<DetectedIntent | null> {
    const response = await this.request('POST', '/intents/detect', { text }, this.internalHeaders());
    if (!response.ok) {
      throw new Error(`Intents service responded ${response.status} on POST /intents/detect`);
    }
    const detection = (await response.json()) as ServiceDetection;
    if (!detection.intent || !detection.initialStep) return null;
    return {
      intent: detection.intent,
      initialStep: detection.initialStep,
      confidence: detection.confidence,
      matchedKeywords: detection.matchedKeywords,
    };
  }

  async list(): Promise<CatalogIntent[]> {
    const response = await this.request('GET', '/internal/intents', undefined, this.internalHeaders());
    if (!response.ok) {
      throw new Error(`Intents service responded ${response.status} on GET /internal/intents`);
    }
    return ((await response.json()) as ServiceIntent[]).map(toCatalogIntent);
  }

  create(accessToken: string, input: CreateIntentInput): Promise<IntentsAdminResult> {
    const { intent, ...rest } = input;
    return this.admin('POST', '/intents', accessToken, { name: intent, ...rest });
  }

  update(accessToken: string, name: string, input: UpdateIntentInput): Promise<IntentsAdminResult> {
    return this.admin('PUT', `/intents/${encodeURIComponent(name)}`, accessToken, input);
  }

  remove(accessToken: string, name: string): Promise<IntentsAdminResult> {
    return this.admin('DELETE', `/intents/${encodeURIComponent(name)}`, accessToken);
  }

  private internalHeaders(): Record<string, string> {
    return { 'X-Internal-Secret': this.internalSecret };
  }

  private async admin(
    method: string,
    path: string,
    accessToken: string,
    body?: unknown,
  ): Promise<IntentsAdminResult> {
    let response: Response;
    try {
      response = await this.request(method, path, body, { Authorization: `Bearer ${accessToken}` });
    } catch {
      return { ok: false, status: 502, error: 'Intents service unavailable' };
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Intents service error';
      return { ok: false, status: response.status, error: message };
    }

    if (payload && typeof payload.name === 'string' && Array.isArray(payload.keywords)) {
      return { ok: true, status: response.status, intent: toCatalogIntent(payload as unknown as ServiceIntent) };
    }
    return { ok: true, status: response.status };
  }

  private request(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}

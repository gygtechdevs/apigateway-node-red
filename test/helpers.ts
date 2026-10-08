import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import { createApp, type AppOverrides } from '../src/app';
import type {
  CatalogIntent,
  IIntentsServiceClient,
  IntentsAdminResult,
} from '../src/application/ports/IIntentsServiceClient';
import type { INodeRedClient, NodeRedCallResult } from '../src/application/ports/INodeRedClient';
import type { IGraphClient, GraphSendResult } from '../src/application/ports/IGraphClient';
import { InMemoryDedupeStore } from '../src/infrastructure/meta/dedupeStore';

export const JWT_SECRET = 'test-jwt-secret';
export const META_APP_SECRET = 'test-app-secret';
export const META_VERIFY_TOKEN = 'test-verify-token';

export const INTENTS: CatalogIntent[] = [
  { intent: 'plazo_fijo', initialStep: '/stepin/abc', keywords: ['plazo fijo'] },
];

export interface FakeIntentsClient extends IIntentsServiceClient {
  adminCalls: Array<{ op: 'create' | 'update' | 'remove'; accessToken: string; name?: string; input?: unknown }>;
  detectCalls: string[];
}

/** In-memory stand-in for intents-service (naive substring detection, no normalization). */
export function fakeIntentsClient(
  intents: CatalogIntent[] = INTENTS,
  adminResult?: IntentsAdminResult,
): FakeIntentsClient {
  const adminCalls: FakeIntentsClient['adminCalls'] = [];
  const detectCalls: string[] = [];
  const ok: IntentsAdminResult = { ok: true, status: 200 };
  return {
    adminCalls,
    detectCalls,
    detect: async (text) => {
      detectCalls.push(text);
      const lower = text.toLowerCase();
      for (const item of intents) {
        const matchedKeywords = item.keywords.filter((k) => lower.includes(k.toLowerCase()));
        if (matchedKeywords.length > 0) {
          return {
            intent: item.intent,
            initialStep: item.initialStep,
            confidence: Math.min(1, matchedKeywords.length / 3),
            matchedKeywords,
          };
        }
      }
      return null;
    },
    list: async () => intents,
    create: async (accessToken, input) => {
      adminCalls.push({ op: 'create', accessToken, input });
      return adminResult ?? { ok: true, status: 201, intent: input };
    },
    update: async (accessToken, name, input) => {
      adminCalls.push({ op: 'update', accessToken, name, input });
      return adminResult ?? { ok: true, status: 200, intent: { intent: name, keywords: [], ...input } };
    },
    remove: async (accessToken, name) => {
      adminCalls.push({ op: 'remove', accessToken, name });
      return adminResult ?? ok;
    },
  };
}

export const GRAPH_PAYLOAD = {
  messaging_product: 'whatsapp',
  to: '5491100000000',
  type: 'text',
  text: { body: 'Hello from Node-RED' },
};

export interface FakeNodeRed extends INodeRedClient {
  calls: Array<{ stepPath: string; payload: Record<string, unknown>; timeoutMs?: number }>;
}

export function fakeNodeRed(result?: Partial<NodeRedCallResult>): FakeNodeRed {
  const calls: FakeNodeRed['calls'] = [];
  return {
    calls,
    post: async (stepPath, payload, options) => {
      calls.push({ stepPath, payload, ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
      return {
        ok: true,
        status: 200,
        data: { graphApiPayload: GRAPH_PAYLOAD, answerContext: { answerText: 'Hello from Node-RED' } },
        rawText: '',
        ...result,
      };
    },
  };
}

export interface FakeGraph extends IGraphClient {
  calls: Array<{ phoneNumberId: string; payload: Record<string, unknown> }>;
}

export function fakeGraph(result: GraphSendResult = { ok: true, status: 200, data: {} }): FakeGraph {
  const calls: FakeGraph['calls'] = [];
  return {
    calls,
    send: async (phoneNumberId, payload) => {
      calls.push({ phoneNumberId, payload });
      return result;
    },
  };
}

export async function makeApp(overrides: AppOverrides = {}): Promise<Express> {
  return createApp({
    config: {
      jwtSecret: JWT_SECRET,
      meta: { appSecret: META_APP_SECRET, verifyToken: META_VERIFY_TOKEN },
    },
    intentsClient: fakeIntentsClient(),
    nodeRedClient: fakeNodeRed(),
    graphClient: fakeGraph(),
    dedupeStore: new InMemoryDedupeStore(),
    ...overrides,
  });
}

export function signToken(
  permissions: string[],
  options: { secret?: string; expiresIn?: number } = {},
): string {
  return jwt.sign({ email: 'user@example.com', permissions }, options.secret ?? JWT_SECRET, {
    algorithm: 'HS256',
    subject: 'user-1',
    expiresIn: options.expiresIn ?? 900,
  });
}

export function signBody(raw: string, secret = META_APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

export function metaWebhookBody(
  overrides: { id?: string; text?: string; phoneNumberId?: string } = {},
): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550001111',
                phone_number_id: overrides.phoneNumberId ?? 'PNID_1',
              },
              contacts: [{ profile: { name: 'Juan' }, wa_id: '5491100000000' }],
              messages: [
                {
                  from: '5491100000000',
                  id: overrides.id ?? 'wamid.A',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: overrides.text ?? 'quiero un plazo fijo' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

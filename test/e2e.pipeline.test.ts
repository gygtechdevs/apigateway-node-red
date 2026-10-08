import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { IntentsServiceClient } from '../src/infrastructure/intents/IntentsServiceClient';
import { NodeRedClientAdapter } from '../src/infrastructure/nodeRed/NodeRedClientAdapter';
import { MetaGraphClient } from '../src/infrastructure/meta/MetaGraphClient';
import { createApp } from '../src/app';
import { InMemoryDedupeStore } from '../src/infrastructure/meta/dedupeStore';
import { JWT_SECRET, META_APP_SECRET, META_VERIFY_TOKEN, metaWebhookBody, signBody } from './helpers';

const INTENTS_URL = 'http://intents.test:4002';
const NODE_RED_URL = 'http://nodered.test:1880';
const INTERNAL_SECRET = 'internal-secret';

/** The reply Node-RED builds (step-close). The gateway must relay it to Graph untouched. */
const NODE_RED_GRAPH_PAYLOAD = {
  type: 'interactive',
  interactive: {
    type: 'button',
    body: { text: 'Plazo fijo: elegi una opcion' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: 'pf_30', title: '30 dias' } },
        { type: 'reply', reply: { id: 'pf_60', title: '60 dias' } },
      ],
    },
  },
};

interface HttpCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** One fake network: intents-service, Node-RED and the Graph API, all mocked at HTTP level. */
function fakeNetwork() {
  const calls: HttpCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body });

    if (url === `${INTENTS_URL}/intents/detect`) {
      return new Response(
        JSON.stringify({
          intent: 'plazo fijo',
          confidence: 1 / 3,
          matchedKeywords: ['plazo fijo'],
          initialStep: '/stepin/pf',
        }),
        { status: 200 },
      );
    }
    if (url === `${NODE_RED_URL}/stepin/pf`) {
      return new Response(
        JSON.stringify({ graphApiPayload: NODE_RED_GRAPH_PAYLOAD, answerContext: { answerText: 'Plazo fijo' } }),
        { status: 200 },
      );
    }
    if (url.startsWith('https://graph.facebook.com/')) {
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.out' }] }), { status: 200 });
    }
    return new Response('not mocked', { status: 599 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('Meta webhook -> gateway -> intents-service -> Node-RED -> Graph API', () => {
  it('sends Graph a payload identical to the graphApiPayload returned by Node-RED', async () => {
    const { calls, fetchImpl } = fakeNetwork();

    const app = await createApp({
      config: {
        jwtSecret: JWT_SECRET,
        meta: { appSecret: META_APP_SECRET, verifyToken: META_VERIFY_TOKEN },
      },
      intentsClient: new IntentsServiceClient({ baseUrl: INTENTS_URL, internalSecret: INTERNAL_SECRET, fetchImpl }),
      nodeRedClient: new NodeRedClientAdapter({ baseUrl: NODE_RED_URL, fetchImpl }),
      graphClient: new MetaGraphClient({ accessToken: 'graph-token', apiVersion: 'v21.0', fetchImpl }),
      dedupeStore: new InMemoryDedupeStore(),
    });

    const raw = metaWebhookBody({ id: 'wamid.E2E', text: 'quiero un plazo fijo', phoneNumberId: 'PNID_9' });
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(raw))
      .send(raw);

    expect(res.status).toBe(200);

    // 1. classification went to intents-service with the inbound text and the internal secret
    const detect = calls.find((c) => c.url === `${INTENTS_URL}/intents/detect`);
    expect(detect?.method).toBe('POST');
    expect(detect?.body).toEqual({ text: 'quiero un plazo fijo' });
    expect(detect?.headers['X-Internal-Secret']).toBe(INTERNAL_SECRET);

    // 2. Node-RED was invoked on the step intents-service chose
    const nodeRed = calls.find((c) => c.url === `${NODE_RED_URL}/stepin/pf`);
    expect(nodeRed?.method).toBe('POST');

    // 3. Graph received exactly what Node-RED built (plus the routing fields the gateway adds)
    const graph = calls.find((c) => c.url.startsWith('https://graph.facebook.com/'));
    expect(graph?.url).toBe('https://graph.facebook.com/v21.0/PNID_9/messages');
    expect(graph?.headers.Authorization).toBe('Bearer graph-token');
    expect(graph?.body).toEqual({
      messaging_product: 'whatsapp',
      to: '5491100000000',
      ...NODE_RED_GRAPH_PAYLOAD,
    });
    const { messaging_product: _mp, to: _to, ...relayed } = graph?.body as Record<string, unknown>;
    expect(relayed).toEqual(NODE_RED_GRAPH_PAYLOAD);

    // order: detect -> Node-RED -> Graph
    const order = calls.map((c) => c.url);
    expect(order).toEqual([
      `${INTENTS_URL}/intents/detect`,
      `${NODE_RED_URL}/stepin/pf`,
      'https://graph.facebook.com/v21.0/PNID_9/messages',
    ]);
  });
});

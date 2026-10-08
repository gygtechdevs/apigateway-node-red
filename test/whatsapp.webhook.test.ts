import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  makeApp,
  signBody,
  metaWebhookBody,
  fakeGraph,
  fakeNodeRed,
  META_VERIFY_TOKEN,
  GRAPH_PAYLOAD,
} from './helpers';

const post = (app: Express, raw: string, signature?: string) => {
  const req = request(app).post('/webhooks/whatsapp').set('Content-Type', 'application/json');
  if (signature) req.set('X-Hub-Signature-256', signature);
  return req.send(raw);
};

describe('GET /webhooks/whatsapp (challenge)', () => {
  it('returns 200 with the challenge as body', async () => {
    const app = await makeApp();
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': META_VERIFY_TOKEN,
      'hub.challenge': 'abc',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('returns 403 on a wrong verify token', async () => {
    const app = await makeApp();
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'nope',
      'hub.challenge': 'abc',
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks/whatsapp', () => {
  it('missing signature -> 403 and nothing is sent', async () => {
    const graph = fakeGraph();
    const app = await makeApp({ graphClient: graph });
    const res = await post(app, metaWebhookBody());
    expect(res.status).toBe(403);
    expect(graph.calls).toHaveLength(0);
  });

  it('invalid signature -> 403', async () => {
    const graph = fakeGraph();
    const app = await makeApp({ graphClient: graph });
    const raw = metaWebhookBody();
    const res = await post(app, raw, signBody(raw, 'wrong-secret'));
    expect(res.status).toBe(403);
    expect(graph.calls).toHaveLength(0);
  });

  it('signature computed over a different body -> 403', async () => {
    const app = await makeApp();
    const res = await post(app, metaWebhookBody(), signBody(metaWebhookBody({ text: 'other' })));
    expect(res.status).toBe(403);
  });

  it('valid signature -> POSTs to Graph and returns 200', async () => {
    const graph = fakeGraph();
    const nodeRed = fakeNodeRed();
    const app = await makeApp({ graphClient: graph, nodeRedClient: nodeRed });
    const raw = metaWebhookBody();
    const res = await post(app, raw, signBody(raw));
    expect(res.status).toBe(200);
    expect(graph.calls).toHaveLength(1);
    expect(graph.calls[0]?.phoneNumberId).toBe('PNID_1');
    expect(graph.calls[0]?.payload).toEqual(GRAPH_PAYLOAD);
    expect(nodeRed.calls[0]?.timeoutMs).toBe(8000);
  });

  it('same messages[0].id twice -> processed once', async () => {
    const graph = fakeGraph();
    const nodeRed = fakeNodeRed();
    const app = await makeApp({ graphClient: graph, nodeRedClient: nodeRed });
    const raw = metaWebhookBody({ id: 'wamid.DUP' });
    const first = await post(app, raw, signBody(raw));
    const second = await post(app, raw, signBody(raw));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(graph.calls).toHaveLength(1);
    expect(nodeRed.calls).toHaveLength(1);
  });

  it('Graph send failure -> 5xx so Meta retries, and the retry is processed again', async () => {
    const failing = fakeGraph({ ok: false, status: 429, data: {} });
    const app = await makeApp({ graphClient: failing });
    const raw = metaWebhookBody({ id: 'wamid.RETRY' });
    const first = await post(app, raw, signBody(raw));
    expect(first.status).toBeGreaterThanOrEqual(500);
    const second = await post(app, raw, signBody(raw));
    expect(second.status).toBeGreaterThanOrEqual(500);
    expect(failing.calls).toHaveLength(2);
  });

  it('Node-RED error status -> 5xx', async () => {
    const nodeRed = fakeNodeRed({ ok: false, status: 500, data: null });
    const app = await makeApp({ nodeRedClient: nodeRed });
    const raw = metaWebhookBody({ id: 'wamid.NR' });
    const res = await post(app, raw, signBody(raw));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('Node-RED timeout/exception -> 5xx', async () => {
    const nodeRed = {
      post: async () => {
        throw new Error('timeout');
      },
    };
    const app = await makeApp({ nodeRedClient: nodeRed });
    const raw = metaWebhookBody({ id: 'wamid.TO' });
    const res = await post(app, raw, signBody(raw));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('status-only notifications (no messages) are acknowledged with 200', async () => {
    const graph = fakeGraph();
    const app = await makeApp({ graphClient: graph });
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'x', status: 'read' }] } }] }],
    });
    const res = await post(app, raw, signBody(raw));
    expect(res.status).toBe(200);
    expect(graph.calls).toHaveLength(0);
  });

  it('does not require a JWT', async () => {
    const app = await makeApp();
    const raw = metaWebhookBody({ id: 'wamid.NOJWT' });
    const res = await post(app, raw, signBody(raw));
    expect(res.status).toBe(200);
  });
});

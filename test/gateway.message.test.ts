import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, signToken, fakeNodeRed, GRAPH_PAYLOAD } from './helpers';

describe('POST /api/gateway/message', () => {
  it('returns JSON (not XML) with the new contract', async () => {
    const nodeRed = fakeNodeRed();
    const app = await makeApp({ nodeRedClient: nodeRed });
    const res = await request(app)
      .post('/api/gateway/message')
      .set('Authorization', `Bearer ${signToken(['READ'])}`)
      .send({ text: 'quiero un plazo fijo', sessionId: 's1' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.text).not.toMatch(/<Response>|<Message>/);
    expect(res.body).toEqual({
      ok: true,
      intent: 'plazo_fijo',
      routedStep: '/stepin/abc',
      graphApiPayload: GRAPH_PAYLOAD,
      replyText: 'Hello from Node-RED',
    });
    expect(nodeRed.calls[0]?.stepPath).toBe('/stepin/abc');
  });

  it('returns 400 when no text is provided', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/gateway/message')
      .set('Authorization', `Bearer ${signToken(['READ'])}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 422 when no intent matches and there is no fallback', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/gateway/message')
      .set('Authorization', `Bearer ${signToken(['READ'])}`)
      .send({ text: 'nothing relevant' });
    expect(res.status).toBe(422);
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, fakeIntentsClient, signToken, INTENTS } from './helpers';

describe('/api/admin/intents delegates to intents-service', () => {
  const body = { intent: 'x', initialStep: '/stepin/x', keywords: ['x'], description: 'desc' };

  it('POST forwards the caller JWT and the payload, answering 201 with the gateway contract', async () => {
    const intentsClient = fakeIntentsClient();
    const app = await makeApp({ intentsClient });
    const token = signToken(['WRITE']);
    const res = await request(app).post('/api/admin/intents').set('Authorization', `Bearer ${token}`).send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, intent: body });
    expect(intentsClient.adminCalls).toEqual([{ op: 'create', accessToken: token, input: body }]);
  });

  it('forwards the JWT when it arrives in the access_token cookie', async () => {
    const intentsClient = fakeIntentsClient();
    const app = await makeApp({ intentsClient });
    const token = signToken(['WRITE']);
    await request(app)
      .post('/api/admin/intents')
      .set('Cookie', `access_token=${encodeURIComponent(token)}`)
      .send(body);
    expect(intentsClient.adminCalls[0]?.accessToken).toBe(token);
  });

  it('PUT forwards name, token and payload', async () => {
    const intentsClient = fakeIntentsClient();
    const app = await makeApp({ intentsClient });
    const token = signToken(['WRITE']);
    const res = await request(app)
      .put('/api/admin/intents/plazo%20fijo')
      .set('Authorization', `Bearer ${token}`)
      .send({ initialStep: '/stepin/v2', keywords: ['a'] });
    expect(res.status).toBe(200);
    expect(intentsClient.adminCalls[0]).toMatchObject({
      op: 'update',
      accessToken: token,
      name: 'plazo fijo',
      input: { initialStep: '/stepin/v2', keywords: ['a'] },
    });
  });

  it('DELETE requires ADMIN at the gateway (WRITE -> 403) and never reaches the service', async () => {
    const intentsClient = fakeIntentsClient();
    const app = await makeApp({ intentsClient });
    const res = await request(app)
      .delete('/api/admin/intents/x')
      .set('Authorization', `Bearer ${signToken(['WRITE'])}`);
    expect(res.status).toBe(403);
    expect(intentsClient.adminCalls).toHaveLength(0);
  });

  it('DELETE with ADMIN forwards to the service', async () => {
    const intentsClient = fakeIntentsClient();
    const app = await makeApp({ intentsClient });
    const token = signToken(['ADMIN']);
    const res = await request(app).delete('/api/admin/intents/x').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(intentsClient.adminCalls).toEqual([{ op: 'remove', accessToken: token, name: 'x' }]);
  });

  it('relays the service status and message on failures (e.g. 409)', async () => {
    const intentsClient = fakeIntentsClient(INTENTS, { ok: false, status: 409, error: 'Intent "x" already exists' });
    const app = await makeApp({ intentsClient });
    const res = await request(app)
      .post('/api/admin/intents')
      .set('Authorization', `Bearer ${signToken(['WRITE'])}`)
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, error: 'Intent "x" already exists' });
  });

  it('keeps validating required fields before calling the service', async () => {
    const intentsClient = fakeIntentsClient();
    const app = await makeApp({ intentsClient });
    const res = await request(app)
      .post('/api/admin/intents')
      .set('Authorization', `Bearer ${signToken(['WRITE'])}`)
      .send({ intent: 'x' });
    expect(res.status).toBe(400);
    expect(intentsClient.adminCalls).toHaveLength(0);
  });

  it('GET lists the catalog read from intents-service', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/admin/intents').set('Authorization', `Bearer ${signToken(['WRITE'])}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, intents: INTENTS });
  });
});

describe('classification is delegated to intents-service', () => {
  it('POST /api/gateway/message sends the text to detect() and routes to the returned initialStep', async () => {
    const intentsClient = fakeIntentsClient([
      { intent: 'remote_intent', initialStep: '/stepin/remote', keywords: ['hello'] },
    ]);
    const app = await makeApp({ intentsClient });
    const res = await request(app)
      .post('/api/gateway/message')
      .set('Authorization', `Bearer ${signToken(['READ'])}`)
      .send({ text: 'hello there' });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('remote_intent');
    expect(res.body.routedStep).toBe('/stepin/remote');
    expect(intentsClient.detectCalls).toEqual(['hello there']);
  });

  it('intents-service outage -> 500 (no local fallback classification)', async () => {
    const intentsClient = fakeIntentsClient();
    intentsClient.detect = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const app = await makeApp({ intentsClient });
    const res = await request(app)
      .post('/api/gateway/message')
      .set('Authorization', `Bearer ${signToken(['READ'])}`)
      .send({ text: 'plazo fijo' });
    expect(res.status).toBe(500);
  });
});

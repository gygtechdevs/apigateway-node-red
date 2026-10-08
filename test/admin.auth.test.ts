import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeApp, signToken, JWT_SECRET } from './helpers';

describe('JWT protection', () => {
  const body = { intent: 'x', initialStep: '/stepin/x', keywords: ['x'] };

  it('POST /api/admin/intents without token -> 401', async () => {
    const app = await makeApp();
    const res = await request(app).post('/api/admin/intents').send(body);
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/intents with invalid signature -> 401', async () => {
    const app = await makeApp();
    const token = signToken(['WRITE'], { secret: 'other-secret' });
    const res = await request(app).post('/api/admin/intents').set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/intents with expired token -> 401', async () => {
    const app = await makeApp();
    const token = signToken(['WRITE'], { expiresIn: -10 });
    const res = await request(app).post('/api/admin/intents').set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/intents with token lacking WRITE -> 403', async () => {
    const app = await makeApp();
    const token = signToken(['READ']);
    const res = await request(app).post('/api/admin/intents').set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(403);
  });

  it('POST /api/admin/intents with WRITE -> 201', async () => {
    const app = await makeApp();
    const token = signToken(['WRITE']);
    const res = await request(app).post('/api/admin/intents').set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(201);
  });

  it('accepts ADMIN as an alternative to WRITE', async () => {
    const app = await makeApp();
    const token = signToken(['ADMIN']);
    const res = await request(app).get('/api/admin/intents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('reads the token from the access_token cookie', async () => {
    const app = await makeApp();
    const token = signToken(['WRITE']);
    const res = await request(app)
      .get('/api/admin/intents')
      .set('Cookie', `foo=bar; access_token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
  });

  it('rejects tokens signed with a non-HS256 algorithm', async () => {
    const app = await makeApp();
    const token = jwt.sign({ permissions: ['WRITE'] }, JWT_SECRET, { algorithm: 'HS512', subject: 'u' });
    const res = await request(app).get('/api/admin/intents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it.each([['/api/gateway/intents'], ['/api/steps']])('GET %s without token -> 401', async (path) => {
    const app = await makeApp();
    expect((await request(app).get(path)).status).toBe(401);
  });

  it('GET /api/gateway/intents with any valid token -> 200', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/gateway/intents').set('Authorization', `Bearer ${signToken([])}`);
    expect(res.status).toBe(200);
    expect(res.body.intents).toHaveLength(1);
  });

  it('POST /api/node-events requires WRITE', async () => {
    const app = await makeApp();
    expect((await request(app).post('/api/node-events').send({})).status).toBe(401);
    const res = await request(app)
      .post('/api/node-events')
      .set('Authorization', `Bearer ${signToken(['READ'])}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('POST /api/gateway/message without token -> 401', async () => {
    const app = await makeApp();
    expect((await request(app).post('/api/gateway/message').send({ text: 'hola' })).status).toBe(401);
  });

  it('GET /health -> 200 without token', async () => {
    const app = await makeApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /api/docs is open', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
  });
});

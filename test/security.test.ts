import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, signBody, metaWebhookBody, META_VERIFY_TOKEN } from './helpers';
import { parseTrustProxy, parseOrigins } from '../src/infrastructure/http/security';

const ALLOWED = 'https://app.example.com';

describe('helmet', () => {
  it('sets security headers and hides x-powered-by', async () => {
    const app = await makeApp();
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows a listed origin with credentials', async () => {
    const app = await makeApp({ security: { corsAllowedOrigins: [ALLOWED] } });
    const res = await request(app).get('/health').set('Origin', ALLOWED);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not emit CORS headers for an unlisted origin', async () => {
    const app = await makeApp({ security: { corsAllowedOrigins: [ALLOWED] } });
    const res = await request(app).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers a preflight for a listed origin and denies an unlisted one', async () => {
    const app = await makeApp({ security: { corsAllowedOrigins: [ALLOWED] } });
    const ok = await request(app)
      .options('/api/gateway/message')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED);
    const denied = await request(app)
      .options('/api/gateway/message')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('denies every origin when the allow-list is empty', async () => {
    const app = await makeApp({ security: { corsAllowedOrigins: [] } });
    const res = await request(app).get('/health').set('Origin', ALLOWED);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never combines a wildcard with credentials', async () => {
    const app = await makeApp({ security: { corsAllowedOrigins: ['*'] } });
    const res = await request(app).get('/health').set('Origin', ALLOWED);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('env parsing', () => {
  it('parses origins', () => {
    expect(parseOrigins(' https://a.com ,https://b.com,, ')).toEqual(['https://a.com', 'https://b.com']);
    expect(parseOrigins(undefined)).toEqual([]);
  });

  it('parses TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toBe(1);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });
});

describe('rate limiting', () => {
  it('is disabled by default under test', async () => {
    const app = await makeApp();
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 on the general limiter after the configured number of requests', async () => {
    const app = await makeApp({
      security: { rateLimit: { enabled: true, generalMax: 2, generalWindowMs: 60_000 } },
    });
    expect((await request(app).get('/api/steps')).status).not.toBe(429);
    expect((await request(app).get('/api/steps')).status).not.toBe(429);
    const res = await request(app).get('/api/steps');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ ok: false, error: 'Too many requests' });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('does not rate limit /health', async () => {
    const app = await makeApp({
      security: { rateLimit: { enabled: true, generalMax: 1, generalWindowMs: 60_000 } },
    });
    for (let i = 0; i < 4; i += 1) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
  });

  it('applies a separate limiter to the webhook, which keeps working under the limit', async () => {
    const app = await makeApp({
      security: {
        rateLimit: { enabled: true, generalMax: 100, webhookMax: 2, webhookWindowMs: 60_000 },
      },
    });
    const challenge = () =>
      request(app).get('/webhooks/whatsapp').query({
        'hub.mode': 'subscribe',
        'hub.verify_token': META_VERIFY_TOKEN,
        'hub.challenge': 'abc',
      });
    expect((await challenge()).status).toBe(200);
    const raw = metaWebhookBody();
    const signed = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(raw))
      .send(raw);
    expect(signed.status).toBe(200);
    const limited = await challenge();
    expect(limited.status).toBe(429);
    // General traffic is not affected by the webhook bucket.
    expect((await request(app).get('/api/steps')).status).not.toBe(429);
  });
});

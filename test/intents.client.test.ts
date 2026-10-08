import { describe, it, expect, vi } from 'vitest';
import { IntentsServiceClient } from '../src/infrastructure/intents/IntentsServiceClient';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stubFetch(status: number, payload: unknown) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const make = (fetchImpl: typeof fetch) =>
  new IntentsServiceClient({ baseUrl: 'http://intents:4002/', internalSecret: 'sek', fetchImpl });

describe('IntentsServiceClient', () => {
  describe('detect', () => {
    it('POSTs the text to /intents/detect with X-Internal-Secret', async () => {
      const detection = { intent: 'pf', confidence: 1, matchedKeywords: ['pf'], initialStep: '/stepin/pf' };
      const { calls, fetchImpl } = stubFetch(200, detection);
      const result = await make(fetchImpl).detect('quiero pf');
      expect(result).toEqual(detection);
      expect(calls[0]).toMatchObject({
        url: 'http://intents:4002/intents/detect',
        method: 'POST',
        body: { text: 'quiero pf' },
      });
      expect(calls[0]?.headers['X-Internal-Secret']).toBe('sek');
    });

    it('returns null when intents-service reports no match', async () => {
      const { fetchImpl } = stubFetch(200, { intent: null, confidence: 0, matchedKeywords: [], initialStep: null });
      expect(await make(fetchImpl).detect('hola')).toBeNull();
    });

    it('throws when the service answers with an error status', async () => {
      const { fetchImpl } = stubFetch(500, { message: 'boom' });
      await expect(make(fetchImpl).detect('x')).rejects.toThrow(/500/);
    });

    it('throws when the service is unreachable', async () => {
      const fetchImpl = (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;
      await expect(make(fetchImpl).detect('x')).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe('list', () => {
    it('reads /internal/intents and maps name -> intent', async () => {
      const { calls, fetchImpl } = stubFetch(200, [
        { id: '1', name: 'pf', keywords: ['pf'], initialStep: '/s/pf', description: 'PF', active: true },
        { id: '2', name: 'tc', keywords: ['tc'], initialStep: '/s/tc', active: true },
      ]);
      const result = await make(fetchImpl).list();
      expect(result).toEqual([
        { intent: 'pf', keywords: ['pf'], initialStep: '/s/pf', description: 'PF' },
        { intent: 'tc', keywords: ['tc'], initialStep: '/s/tc' },
      ]);
      expect(calls[0]?.url).toBe('http://intents:4002/internal/intents');
      expect(calls[0]?.headers['X-Internal-Secret']).toBe('sek');
    });
  });

  describe('admin operations forward the caller JWT', () => {
    it('create -> POST /intents with Bearer token and name field', async () => {
      const { calls, fetchImpl } = stubFetch(201, { id: '1', name: 'pf', keywords: ['pf'], initialStep: '/s' });
      const result = await make(fetchImpl).create('jwt-1', { intent: 'pf', initialStep: '/s', keywords: ['pf'] });
      expect(result).toEqual({ ok: true, status: 201, intent: { intent: 'pf', keywords: ['pf'], initialStep: '/s' } });
      expect(calls[0]).toMatchObject({
        url: 'http://intents:4002/intents',
        method: 'POST',
        body: { name: 'pf', initialStep: '/s', keywords: ['pf'] },
      });
      expect(calls[0]?.headers.Authorization).toBe('Bearer jwt-1');
      expect(calls[0]?.headers['X-Internal-Secret']).toBeUndefined();
    });

    it('update -> PUT /intents/:name (url-encoded)', async () => {
      const { calls, fetchImpl } = stubFetch(200, { id: '1', name: 'plazo fijo', keywords: ['a'], initialStep: '/s2' });
      const result = await make(fetchImpl).update('jwt-2', 'plazo fijo', { initialStep: '/s2', keywords: ['a'] });
      expect(result.ok).toBe(true);
      expect(calls[0]).toMatchObject({
        url: 'http://intents:4002/intents/plazo%20fijo',
        method: 'PUT',
        body: { initialStep: '/s2', keywords: ['a'] },
      });
      expect(calls[0]?.headers.Authorization).toBe('Bearer jwt-2');
    });

    it('remove -> DELETE /intents/:name', async () => {
      const { calls, fetchImpl } = stubFetch(200, { deleted: true, name: 'pf' });
      expect(await make(fetchImpl).remove('jwt-3', 'pf')).toEqual({ ok: true, status: 200 });
      expect(calls[0]).toMatchObject({ url: 'http://intents:4002/intents/pf', method: 'DELETE' });
      expect(calls[0]?.headers.Authorization).toBe('Bearer jwt-3');
    });

    it('maps service errors keeping the status and message', async () => {
      const { fetchImpl } = stubFetch(409, { message: 'Intent "pf" already exists' });
      const result = await make(fetchImpl).create('jwt', { intent: 'pf', initialStep: '/s', keywords: ['pf'] });
      expect(result).toEqual({ ok: false, status: 409, error: 'Intent "pf" already exists' });
    });

    it('maps an unreachable service to 502', async () => {
      const fetchImpl = (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;
      const result = await make(fetchImpl).remove('jwt', 'pf');
      expect(result).toEqual({ ok: false, status: 502, error: 'Intents service unavailable' });
    });
  });
});

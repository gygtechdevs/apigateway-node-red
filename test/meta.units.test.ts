import { describe, it, expect, vi } from 'vitest';
import { parseMetaInbound, textBody } from '../src/infrastructure/meta/MetaInboundParser';
import { MetaGraphClient } from '../src/infrastructure/meta/MetaGraphClient';
import { InMemoryDedupeStore } from '../src/infrastructure/meta/dedupeStore';
import { metaWebhookBody } from './helpers';

describe('MetaInboundParser', () => {
  it('extracts the first message', () => {
    const msg = parseMetaInbound(JSON.parse(metaWebhookBody({ id: 'wamid.1', text: 'hola' })));
    expect(msg).toMatchObject({
      messageId: 'wamid.1',
      from: '5491100000000',
      phoneNumberId: 'PNID_1',
      type: 'text',
    });
    expect(msg && textBody(msg)).toBe('hola');
  });

  it('returns null when there are no messages', () => {
    expect(parseMetaInbound({ entry: [{ changes: [{ value: { statuses: [] } }] }] })).toBeNull();
    expect(parseMetaInbound(null)).toBeNull();
  });

  it.each([
    [{ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'btn_1', title: 'T' } } }, 'btn_1'],
    [{ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'row_1', title: 'T' } } }, 'row_1'],
    [{ type: 'image', image: { caption: 'a picture' } }, 'a picture'],
    [{ type: 'video', video: { caption: 'a video' } }, 'a video'],
    [{ type: 'document', document: { caption: 'a doc' } }, 'a doc'],
    [{ type: 'sticker', sticker: {} }, ''],
  ])('textBody for %j', (extra, expected) => {
    const body = {
      entry: [
        { changes: [{ value: { metadata: { phone_number_id: 'P' }, messages: [{ id: 'm', from: 'f', ...extra }] } }] },
      ],
    };
    const msg = parseMetaInbound(body)!;
    expect(textBody(msg)).toBe(expected);
  });
});

describe('MetaGraphClient', () => {
  const payload = { messaging_product: 'whatsapp', to: '1', type: 'text', text: { body: 'x' } };
  const resp = (status: number, body: unknown = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const noSleep = async (): Promise<void> => undefined;

  it('POSTs to the versioned Graph URL with the Bearer token', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => resp(200, { messages: [{ id: 'w' }] }));
    const client = new MetaGraphClient({ accessToken: 'tok', apiVersion: 'v21.0', fetchImpl, sleep: noSleep });
    const result = await client.send('PN', payload);
    expect(result).toEqual({ ok: true, status: 200, data: { messages: [{ id: 'w' }] } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v21.0/PN/messages');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('accepts an API version without the v prefix', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => resp(200));
    const client = new MetaGraphClient({ accessToken: 't', apiVersion: '21.0', fetchImpl, sleep: noSleep });
    await client.send('PN', payload);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://graph.facebook.com/v21.0/PN/messages');
  });

  it('retries 429 and 5xx with backoff, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(429))
      .mockResolvedValueOnce(resp(503))
      .mockResolvedValueOnce(resp(200));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new MetaGraphClient({ accessToken: 't', apiVersion: 'v21.0', fetchImpl, sleep });
    const result = await client.send('PN', payload);
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and reports ok=false', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => resp(500));
    const client = new MetaGraphClient({
      accessToken: 't',
      apiVersion: 'v21.0',
      fetchImpl,
      sleep: noSleep,
      maxRetries: 2,
    });
    const result = await client.send('PN', payload);
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx other than 429', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => resp(400, { error: { message: 'bad' } }));
    const client = new MetaGraphClient({ accessToken: 't', apiVersion: 'v21.0', fetchImpl, sleep: noSleep });
    const result = await client.send('PN', payload);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(resp(200));
    const client = new MetaGraphClient({ accessToken: 't', apiVersion: 'v21.0', fetchImpl, sleep: noSleep });
    expect((await client.send('PN', payload)).ok).toBe(true);
  });
});

describe('InMemoryDedupeStore', () => {
  it('claims an id only once until released', async () => {
    const store = new InMemoryDedupeStore();
    expect(await store.claim('a')).toBe(true);
    expect(await store.claim('a')).toBe(false);
    await store.release('a');
    expect(await store.claim('a')).toBe(true);
  });

  it('expires entries after the TTL', async () => {
    let now = 0;
    const store = new InMemoryDedupeStore(1000, () => now);
    expect(await store.claim('a')).toBe(true);
    now = 1001;
    expect(await store.claim('a')).toBe(true);
  });
});

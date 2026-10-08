import Redis from 'ioredis';
import type { IDedupeStore } from '../../application/ports/IDedupeStore';

export const DEDUPE_TTL_SECONDS = 600; // 10 minutes
const KEY_PREFIX = 'meta:msg:';

export class InMemoryDedupeStore implements IDedupeStore {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DEDUPE_TTL_SECONDS * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async claim(id: string): Promise<boolean> {
    const now = this.now();
    this.evictExpired(now);
    if (this.entries.has(id)) return false;
    this.entries.set(id, now + this.ttlMs);
    return true;
  }

  async release(id: string): Promise<void> {
    this.entries.delete(id);
  }

  private evictExpired(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}

export class RedisDedupeStore implements IDedupeStore {
  constructor(
    private readonly redis: Pick<Redis, 'set' | 'del'>,
    private readonly ttlSeconds: number = DEDUPE_TTL_SECONDS,
  ) {}

  async claim(id: string): Promise<boolean> {
    const result = await this.redis.set(`${KEY_PREFIX}${id}`, '1', 'EX', this.ttlSeconds, 'NX');
    return result === 'OK';
  }

  async release(id: string): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}${id}`);
  }
}

export function createDedupeStore(redisUrl: string | undefined): IDedupeStore {
  if (!redisUrl) return new InMemoryDedupeStore();
  return new RedisDedupeStore(new Redis(redisUrl, { maxRetriesPerRequest: 2 }));
}

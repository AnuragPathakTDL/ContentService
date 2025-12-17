import type { Redis } from "ioredis";

export async function getCachedJson<T>(
  redis: Redis,
  key: string
): Promise<T | null> {
  const payload = await redis.get(key);
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    await redis.del(key);
    return null;
  }
}

export async function setCachedJson(
  redis: Redis,
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const payload = JSON.stringify(value);
  if (ttlSeconds > 0) {
    await redis.set(key, payload, "EX", ttlSeconds);
    return;
  }
  await redis.set(key, payload);
}

import { LRUCache } from "lru-cache";
import { env } from "../config/env";

/**
 * In-process LRU cache that tracks recently handled X-Hub-Delivery IDs.
 * Prevents redundant LLM calls when GitHub retries a delivery within the
 * same process lifetime. Bounded by max entry count and per-entry TTL so it
 * cannot grow unbounded regardless of traffic volume.
 */
const dedupCache = new LRUCache<string, true>({
  max: env.DEDUP_CACHE_MAX,
  ttl: env.DEDUP_CACHE_TTL_MS,
});

/**
 * Returns true if this delivery ID has already been processed and marks it
 * as seen. Returns false (and marks it) on the first call for a given ID.
 */
export function isDuplicate(deliveryId: string): boolean {
  if (dedupCache.has(deliveryId)) {
    return true;
  }
  dedupCache.set(deliveryId, true);
  return false;
}

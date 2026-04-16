import { LRUCache } from "lru-cache";
import { env } from "../config/env";

/**
 * In-process caches that track webhook delivery lifecycle by X-Hub-Delivery ID.
 * - inFlightCache prevents concurrent duplicate processing of the same delivery
 * - completedCache prevents reprocessing deliveries that already succeeded
 *
 * Both are bounded by max entry count and TTL, so memory use remains capped.
 */
const inFlightCache = new LRUCache<string, true>({
  max: env.DEDUP_CACHE_MAX,
  ttl: env.DEDUP_CACHE_TTL_MS,
});

const completedCache = new LRUCache<string, true>({
  max: env.DEDUP_CACHE_MAX,
  ttl: env.DEDUP_CACHE_TTL_MS,
});

export type DeliveryStartResult = "started" | "duplicate";

/**
 * Attempts to start processing for this delivery ID.
 * Returns:
 * - "started" on first process attempt
 * - "duplicate" if already in-flight or already completed
 */
export function startDelivery(deliveryId: string): DeliveryStartResult {
  if (inFlightCache.has(deliveryId) || completedCache.has(deliveryId)) {
    return "duplicate";
  }
  inFlightCache.set(deliveryId, true);
  return "started";
}

/** Marks a delivery as successfully processed. */
export function completeDelivery(deliveryId: string): void {
  inFlightCache.delete(deliveryId);
  completedCache.set(deliveryId, true);
}

/** Marks a delivery as failed so future redeliveries can retry it. */
export function failDelivery(deliveryId: string): void {
  inFlightCache.delete(deliveryId);
}

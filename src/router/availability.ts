import type { Capabilities, ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { RUNNER_REGISTRY } from "../runners/registry.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

interface CacheEntry {
  caps: Capabilities;
  expiresAt: number;
}

const cache = new Map<ProviderId, CacheEntry>();

export interface DetectOptions {
  /** If true, bypass the cache and re-measure. */
  force?: boolean;
  /** If true, also run the `--version` probe (healthy state). */
  probe?: boolean;
}

/**
 * Detect availability of a single provider. Result is memoized for 1h per
 * process unless `force: true` is passed. Call `invalidate()` when a runtime
 * error (auth/quota) indicates the cached state is stale.
 */
export async function detect(
  id: ProviderId,
  opts: DetectOptions = {},
): Promise<Capabilities> {
  const now = Date.now();
  if (!opts.force) {
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now) return hit.caps;
  }
  const caps = await RUNNER_REGISTRY[id].capabilities({ probe: opts.probe });
  cache.set(id, { caps, expiresAt: now + ONE_HOUR_MS });
  return caps;
}

/** Detect every provider in parallel. */
export async function detectAll(
  opts: DetectOptions = {},
): Promise<Record<ProviderId, Capabilities>> {
  const entries = await Promise.all(
    ALL_PROVIDERS.map(async (id) => [id, await detect(id, opts)] as const),
  );
  return Object.fromEntries(entries) as Record<ProviderId, Capabilities>;
}

/**
 * Mark a provider as stale so the next `detect()` re-measures. Call this when
 * a runner returns an authentication / quota / network failure at runtime.
 */
export function invalidate(id: ProviderId): void {
  cache.delete(id);
}

/** Return the subset of providers whose CLI is installed AND authenticated. */
export function usableProviders(
  all: Record<ProviderId, Capabilities>,
): ProviderId[] {
  return ALL_PROVIDERS.filter((id) => {
    const c = all[id];
    return c.installed && c.authenticated;
  });
}

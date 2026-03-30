import { getConfig } from '../config/settings';

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

interface CachedModels {
  models: OllamaModel[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;
let cache: CachedModels | undefined;

export async function listOllamaModels(forceRefresh = false): Promise<OllamaModel[]> {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }

  const config = getConfig();
  const endpoint = config.ollama.endpoint.replace(/\/$/, '');

  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return cache?.models || [];
    }

    const data = (await response.json()) as { models?: OllamaModel[] };
    const models = data.models || [];

    cache = { models, fetchedAt: Date.now() };
    return models;
  } catch {
    return cache?.models || [];
  }
}

export function formatModelSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export function invalidateCache(): void {
  cache = undefined;
}

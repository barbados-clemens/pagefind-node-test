/**
 * Node.js Pagefind search client — public API.
 *
 * Usage:
 *   const client = await createSearchClient({
 *     basePath: 'https://nx.dev/docs/pagefind/',
 *   });
 *   const results = await client.search('webpack configuration');
 *   for (const result of results.results.slice(0, 5)) {
 *     const data = await result.data();
 *     console.log(`${data.meta.title} — ${data.url}`);
 *   }
 */

import { PagefindClient } from './pagefind-client';
import type {
  NodePagefindOptions,
  SearchResponse,
  SearchResult,
} from './types';

export type { NodePagefindOptions, SearchResponse, SearchResult };
export type { PagefindFragment, SubResult, WeightedLocation } from './types';

export interface PagefindSearchClient {
  search(
    query: string,
    options?: {
      filters?: Record<string, string[]>;
      sort?: Record<string, 'asc' | 'desc'>;
      verbose?: boolean;
    }
  ): Promise<SearchResponse>;
}

/**
 * Create and initialize a Pagefind search client.
 *
 * @param options.basePath  URL to the pagefind directory (must contain pagefind-entry.json)
 * @param options.excerptLength  Number of words in excerpts (default: 30)
 * @param options.ranking  Custom ranking weight overrides
 */
export async function createSearchClient(
  options: NodePagefindOptions
): Promise<PagefindSearchClient> {
  const client = new PagefindClient(options);
  await client.init();
  return client;
}

/**
 * Node.js Pagefind search client — reimplements pagefind's browser client
 * using the WASM bindings directly with Node.js built-ins.
 *
 * Zero external dependencies: uses zlib, fetch, WebAssembly, TextEncoder/TextDecoder.
 */

import { gunzipSync } from 'zlib';
import type {
  NodePagefindOptions,
  PagefindEntry,
  PagefindFragment,
  SearchResponse,
  SearchResult,
  SubResult,
  WeightedLocation,
  WasmExports,
} from './types';
import {
  initPagefind,
  loadFilterChunk as wasmLoadFilterChunk,
  loadIndexChunk as wasmLoadIndexChunk,
  requestFilterIndexes,
  requestIndexes,
  setRankingWeights,
  wasmSearch,
} from './wasm-bridge';

const decoder = new TextDecoder('utf-8');
const SIGNATURE = 'pagefind_dcd';

// ---------------------------------------------------------------------------
// Decompression — replaces the 200+ line custom inflate/gunzip in pagefind.js
// ---------------------------------------------------------------------------

function decompress(data: Uint8Array): Uint8Array {
  // Already decompressed (has the pagefind_dcd signature)
  if (decoder.decode(data.slice(0, 12)) === SIGNATURE) {
    return data.slice(12);
  }
  const decompressed = gunzipSync(Buffer.from(data));
  const result = new Uint8Array(decompressed);
  if (decoder.decode(result.slice(0, 12)) !== SIGNATURE) {
    // Missing signature — return as-is
    return result;
  }
  return result.slice(12);
}

// ---------------------------------------------------------------------------
// Excerpt & sub-result helpers (pure JS, ported from pagefind.js)
// ---------------------------------------------------------------------------

function calculateExcerptRegion(
  wordPositions: WeightedLocation[],
  excerptLength: number
): number {
  if (wordPositions.length === 0) return 0;

  const words: number[] = [];
  for (const word of wordPositions) {
    words[word.location] = (words[word.location] || 0) + word.balanced_score;
  }

  if (words.length <= excerptLength) return 0;

  let densest = words
    .slice(0, excerptLength)
    .reduce((sum, a) => sum + (a ?? 0), 0);
  let workingSum = densest;
  let densestAt = [0];

  for (let i = 0; i < words.length; i++) {
    const boundary = i + excerptLength;
    workingSum += (words[boundary] ?? 0) - (words[i] ?? 0);
    if (workingSum > densest) {
      densest = workingSum;
      densestAt = [i];
    } else if (
      workingSum === densest &&
      densestAt[densestAt.length - 1] === i - 1
    ) {
      densestAt.push(i);
    }
  }

  return densestAt[Math.floor(densestAt.length / 2)];
}

function buildExcerpt(
  content: string,
  start: number,
  length: number,
  locations: number[],
  notBefore?: number,
  notFrom?: number
): string {
  const isZwsDelimited = content.includes('\u200B');
  const fragmentWords = isZwsDelimited
    ? content.split('\u200B')
    : content.split(/[\r\n\s]+/g);

  for (const word of locations) {
    if (fragmentWords[word]?.startsWith('<mark>')) continue;
    fragmentWords[word] = `<mark>${fragmentWords[word]}</mark>`;
  }

  const endcap = notFrom ?? fragmentWords.length;
  const startcap = notBefore ?? 0;

  if (endcap - startcap < length) length = endcap - startcap;
  if (start + length > endcap) start = endcap - length;
  if (start < startcap) start = startcap;

  return fragmentWords
    .slice(start, start + length)
    .join(isZwsDelimited ? '' : ' ')
    .trim();
}

function calculateSubResults(
  fragment: PagefindFragment,
  desiredExcerptLength: number
): SubResult[] {
  const anchors = fragment.anchors
    .filter(
      (a) => /h\d/i.test(a.element) && a.text?.length && /\S/.test(a.text)
    )
    .sort((a, b) => a.location - b.location);

  const results: SubResult[] = [];
  let currentAnchorPosition = 0;
  let currentAnchor: SubResult = {
    title: fragment.meta['title'],
    url: fragment.url,
    weighted_locations: [],
    locations: [],
    excerpt: '',
  };

  const addResult = (endRange?: number) => {
    if (currentAnchor.locations.length) {
      const relativeWeighted = currentAnchor.weighted_locations.map((l) => ({
        weight: l.weight,
        balanced_score: l.balanced_score,
        location: l.location - currentAnchorPosition,
      }));
      const excerptStart =
        calculateExcerptRegion(relativeWeighted, desiredExcerptLength) +
        currentAnchorPosition;
      const excerptLength = endRange
        ? Math.min(endRange - excerptStart, desiredExcerptLength)
        : desiredExcerptLength;
      currentAnchor.excerpt = buildExcerpt(
        fragment.raw_content ?? '',
        excerptStart,
        excerptLength,
        currentAnchor.locations,
        currentAnchorPosition,
        endRange
      );
      results.push(currentAnchor);
    }
  };

  for (const word of fragment.weighted_locations) {
    if (!anchors.length || word.location < anchors[0].location) {
      currentAnchor.weighted_locations.push(word);
      currentAnchor.locations.push(word.location);
    } else {
      let nextAnchor = anchors.shift()!;
      addResult(nextAnchor.location);

      while (anchors.length && word.location >= anchors[0].location) {
        nextAnchor = anchors.shift()!;
      }

      let anchoredUrl = fragment.url;
      if (/^((https?:)?\/\/)/.test(anchoredUrl)) {
        const fqUrl = new URL(anchoredUrl);
        fqUrl.hash = nextAnchor.id;
        anchoredUrl = fqUrl.toString();
      } else {
        if (!/^\//.test(anchoredUrl)) anchoredUrl = `/${anchoredUrl}`;
        const fqUrl = new URL(`https://example.com${anchoredUrl}`);
        fqUrl.hash = nextAnchor.id;
        anchoredUrl = fqUrl.toString().replace(/^https:\/\/example\.com/, '');
      }

      currentAnchorPosition = nextAnchor.location;
      currentAnchor = {
        title: nextAnchor.text,
        url: anchoredUrl,
        anchor: nextAnchor,
        weighted_locations: [word],
        locations: [word.location],
        excerpt: '',
      };
    }
  }

  addResult(anchors[0]?.location);
  return results;
}

// ---------------------------------------------------------------------------
// Filter parsing (same format as pagefind.js)
// ---------------------------------------------------------------------------

function parseFilters(str: string): Record<string, Record<string, number>> {
  const output: Record<string, Record<string, number>> = {};
  if (!str) return output;

  for (const block of str.split('__PF_FILTER_DELIM__')) {
    const [filter, values] = block.split(/:(.*)$/);
    output[filter] = {};
    if (values) {
      for (const valueBlock of values.split('__PF_VALUE_DELIM__')) {
        if (valueBlock) {
          const extract = valueBlock.match(/^(.*):(\d+)$/);
          if (extract) {
            const [, value, count] = extract;
            output[filter][value] = parseInt(count) ?? 0;
          }
        }
      }
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// PagefindClient
// ---------------------------------------------------------------------------

export class PagefindClient {
  private basePath: string;
  private excerptLength: number;
  private ranking: NodePagefindOptions['ranking'];
  private wasm: WasmExports | null = null;
  private rawPtr: number | null = null;
  private loadedChunks = new Map<string, Promise<void>>();
  private loadedFilters = new Map<string, Promise<void>>();
  private loadedFragments = new Map<string, Promise<PagefindFragment>>();

  constructor(options: NodePagefindOptions) {
    this.basePath = options.basePath.replace(/\/?$/, '/');
    this.excerptLength = options.excerptLength ?? 30;
    this.ranking = options.ranking;
  }

  /**
   * Initialize — fetch entry, meta, and WASM; instantiate the WASM module.
   */
  async init(): Promise<void> {
    // 1. Fetch entry JSON
    const entryResp = await fetch(`${this.basePath}pagefind-entry.json`);
    if (!entryResp.ok) {
      throw new Error(
        `Failed to fetch pagefind-entry.json: ${entryResp.status}`
      );
    }
    const entry: PagefindEntry = await entryResp.json();

    // Pick the language index with the most pages
    const langEntries = Object.values(entry.languages);
    if (!langEntries.length) {
      throw new Error('Pagefind: No language indexes found');
    }
    const index = langEntries.sort((a, b) => b.page_count - a.page_count)[0];

    // 2. Fetch + decompress meta and WASM in parallel
    const [metaBytes, wasmBytes] = await Promise.all([
      this.fetchAndDecompress(`${this.basePath}pagefind.${index.hash}.pf_meta`),
      this.fetchAndDecompress(
        `${this.basePath}wasm.${index.wasm || 'unknown'}.pagefind`
      ),
    ]);

    // 3. Instantiate WASM (zero imports)
    const { instance } = await WebAssembly.instantiate(wasmBytes, {
      wbg: {},
    });
    this.wasm = instance.exports as unknown as WasmExports;

    // 4. Initialize pagefind with meta
    this.rawPtr = initPagefind(this.wasm, metaBytes);

    // 5. Apply ranking weights if provided
    if (this.ranking) {
      const weights = {
        term_similarity: this.ranking.termSimilarity ?? null,
        page_length: this.ranking.pageLength ?? null,
        term_saturation: this.ranking.termSaturation ?? null,
        term_frequency: this.ranking.termFrequency ?? null,
      };
      this.rawPtr = setRankingWeights(
        this.wasm,
        this.rawPtr,
        JSON.stringify(weights)
      );
    }
  }

  /**
   * Search for a term and return results with lazy fragment loading.
   */
  async search(
    term: string,
    options: {
      filters?: Record<string, string[]>;
      sort?: Record<string, 'asc' | 'desc'>;
      verbose?: boolean;
    } = {}
  ): Promise<SearchResponse> {
    if (!this.wasm || this.rawPtr === null) {
      throw new Error('PagefindClient not initialized — call init() first');
    }

    const log = (msg: string) => {
      if (options.verbose) console.error(msg);
    };

    const start = Date.now();

    // Normalize query (same as pagefind.js)
    const exactSearch = /^\s*".+"\s*$/.test(term);
    const normalized = term
      .toLowerCase()
      .trim()
      .replace(/[.`~!@#$%^&*(){}[\]\\|:;'",<>/?\-]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    log(`Normalized search term: "${normalized}"`);

    if (!normalized.length) {
      return {
        results: [],
        unfilteredResultCount: 0,
        filters: {},
        totalFilters: {},
        timings: { preload: 0, search: 0, total: 0 },
      };
    }

    const filterStr = JSON.stringify(options.filters ?? {});
    const sortStr = this.stringifySorts(options.sort ?? {});

    // Request needed index + filter chunks
    const indexResp = requestIndexes(this.wasm, this.rawPtr, normalized);
    const filterResp = requestFilterIndexes(this.wasm, this.rawPtr, filterStr);

    const chunkLoads = indexResp
      .split(' ')
      .filter(Boolean)
      .map((hash) => this.loadChunk(hash));

    const filterLoads = filterResp
      .split(' ')
      .filter(Boolean)
      .map((hash) => this.loadFilterChunkByHash(hash));

    await Promise.all([...chunkLoads, ...filterLoads]);
    log(
      `Loaded ${chunkLoads.length} index + ${filterLoads.length} filter chunks`
    );

    // Execute search
    const searchStart = Date.now();
    const rawResult = wasmSearch(
      this.wasm,
      this.rawPtr,
      normalized,
      filterStr,
      sortStr,
      exactSearch
    );

    // Parse: count:results:filters__PF_UNFILTERED_DELIM__totalFilters
    const [unfilteredStr, allResults, filtersStr, totalFiltersStr] =
      rawResult.split(/:([^:]*):(.*)__PF_UNFILTERED_DELIM__(.*)$/);

    const filterObj = parseFilters(filtersStr);
    const totalFilterObj = parseFilters(totalFiltersStr);

    const results: SearchResult[] = allResults.length
      ? allResults.split(' ').map((r) => {
          const [hash, score, allLocations] = r.split('@');
          const weightedLocations: WeightedLocation[] = allLocations.length
            ? allLocations.split(',').map((l) => {
                const [weight, balancedScore, location] = l.split('>');
                return {
                  weight: parseInt(weight) / 24,
                  balanced_score: parseFloat(balancedScore),
                  location: parseInt(location),
                };
              })
            : [];

          return {
            id: hash,
            score: parseFloat(score),
            words: weightedLocations.map((l) => l.location),
            data: () => this.loadFragment(hash, weightedLocations, normalized),
          };
        })
      : [];

    const searchTime = Date.now() - searchStart;
    const totalTime = Date.now() - start;
    log(
      `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${normalized}" in ${searchTime}ms (${totalTime}ms total)`
    );

    return {
      results,
      unfilteredResultCount: parseInt(unfilteredStr),
      filters: filterObj,
      totalFilters: totalFilterObj,
      timings: {
        preload: totalTime - searchTime,
        search: searchTime,
        total: totalTime,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async fetchAndDecompress(url: string): Promise<Uint8Array> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    return decompress(new Uint8Array(buf));
  }

  private async loadChunk(hash: string): Promise<void> {
    if (!this.loadedChunks.has(hash)) {
      this.loadedChunks.set(hash, this._loadChunk(hash));
    }
    return this.loadedChunks.get(hash)!;
  }

  private async _loadChunk(hash: string): Promise<void> {
    const url = `${this.basePath}index/${hash}.pf_index`;
    const chunk = await this.fetchAndDecompress(url);
    this.rawPtr = wasmLoadIndexChunk(this.wasm!, this.rawPtr!, chunk);
  }

  private async loadFilterChunkByHash(hash: string): Promise<void> {
    if (!this.loadedFilters.has(hash)) {
      this.loadedFilters.set(hash, this._loadFilterChunk(hash));
    }
    return this.loadedFilters.get(hash)!;
  }

  private async _loadFilterChunk(hash: string): Promise<void> {
    const url = `${this.basePath}filter/${hash}.pf_filter`;
    const chunk = await this.fetchAndDecompress(url);
    this.rawPtr = wasmLoadFilterChunk(this.wasm!, this.rawPtr!, chunk);
  }

  private async loadFragment(
    hash: string,
    weightedLocations: WeightedLocation[],
    searchTerm: string
  ): Promise<PagefindFragment> {
    if (!this.loadedFragments.has(hash)) {
      this.loadedFragments.set(hash, this._loadFragment(hash));
    }
    const fragment = structuredClone(await this.loadedFragments.get(hash)!);

    // Attach search-specific data
    fragment.weighted_locations = weightedLocations;
    fragment.locations = weightedLocations.map((l) => l.location);

    if (!fragment.raw_content) {
      fragment.raw_content = fragment.content
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      fragment.content = fragment.content.replace(/\u200B/g, '');
    }

    const excerptStart = calculateExcerptRegion(
      weightedLocations,
      this.excerptLength
    );
    fragment.excerpt = buildExcerpt(
      fragment.raw_content,
      excerptStart,
      this.excerptLength,
      fragment.locations
    );

    fragment.sub_results = calculateSubResults(fragment, this.excerptLength);
    return fragment;
  }

  private async _loadFragment(hash: string): Promise<PagefindFragment> {
    const url = `${this.basePath}fragment/${hash}.pf_fragment`;
    const data = await this.fetchAndDecompress(url);
    return JSON.parse(decoder.decode(data));
  }

  private stringifySorts(obj: Record<string, string>): string {
    for (const [sort, direction] of Object.entries(obj)) {
      return `${sort}:${direction}`;
    }
    return '';
  }
}

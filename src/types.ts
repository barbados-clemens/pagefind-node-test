/**
 * Types for the Node.js Pagefind search client.
 */

export interface PagefindEntry {
  version: string;
  languages: Record<string, { hash: string; wasm: string; page_count: number }>;
}

export interface WeightedLocation {
  weight: number;
  balanced_score: number;
  location: number;
}

export interface PagefindAnchor {
  element: string;
  id: string;
  text: string;
  location: number;
}

export interface PagefindFragment {
  url: string;
  raw_url?: string;
  content: string;
  raw_content?: string;
  word_count: number;
  filters: Record<string, string[]>;
  meta: Record<string, string>;
  anchors: PagefindAnchor[];
  weighted_locations: WeightedLocation[];
  locations: number[];
  sub_results: SubResult[];
  excerpt: string;
}

export interface SubResult {
  title: string;
  url: string;
  anchor?: PagefindAnchor;
  weighted_locations: WeightedLocation[];
  locations: number[];
  excerpt: string;
}

export interface SearchResult {
  id: string;
  score: number;
  words: number[];
  data: () => Promise<PagefindFragment>;
}

export interface SearchResponse {
  results: SearchResult[];
  unfilteredResultCount: number;
  filters: Record<string, Record<string, number>>;
  totalFilters: Record<string, Record<string, number>>;
  timings: {
    preload: number;
    search: number;
    total: number;
  };
}

export interface NodePagefindOptions {
  basePath: string;
  excerptLength?: number;
  ranking?: {
    termSimilarity?: number | null;
    pageLength?: number | null;
    termSaturation?: number | null;
    termFrequency?: number | null;
  };
}

export interface WasmExports {
  memory: WebAssembly.Memory;
  __wbindgen_malloc: (size: number, align: number) => number;
  __wbindgen_realloc: (
    ptr: number,
    oldSize: number,
    newSize: number,
    align: number
  ) => number;
  __wbindgen_free: (ptr: number, size: number, align: number) => void;
  __wbindgen_add_to_stack_pointer: (delta: number) => number;
  init_pagefind: (ptr: number, len: number) => number;
  search: (
    retptr: number,
    ptr: number,
    queryPtr: number,
    queryLen: number,
    filterPtr: number,
    filterLen: number,
    sortPtr: number,
    sortLen: number,
    exact: boolean
  ) => void;
  request_indexes: (
    retptr: number,
    ptr: number,
    queryPtr: number,
    queryLen: number
  ) => void;
  request_filter_indexes: (
    retptr: number,
    ptr: number,
    filterPtr: number,
    filterLen: number
  ) => void;
  request_all_filter_indexes: (retptr: number, ptr: number) => void;
  load_index_chunk: (ptr: number, chunkPtr: number, chunkLen: number) => number;
  load_filter_chunk: (
    ptr: number,
    chunkPtr: number,
    chunkLen: number
  ) => number;
  set_ranking_weights: (
    ptr: number,
    weightsPtr: number,
    weightsLen: number
  ) => number;
  filters: (retptr: number, ptr: number) => void;
  add_synthetic_filter: (
    ptr: number,
    filterPtr: number,
    filterLen: number
  ) => number;
}

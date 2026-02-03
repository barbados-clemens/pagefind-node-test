/**
 * WASM binding helpers — thin typed wrappers around the pagefind WASM exports.
 *
 * Ported from the wasm_bindgen layer in pagefind.js (~50 lines of real logic).
 * The WASM module has zero imports ({ wbg: {} }).
 */

import type { WasmExports } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

let cachedUint8: Uint8Array | null = null;
let cachedInt32: Int32Array | null = null;
let WASM_VECTOR_LEN = 0;

function getUint8(wasm: WasmExports): Uint8Array {
  if (cachedUint8 === null || cachedUint8.byteLength === 0) {
    cachedUint8 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8;
}

function getInt32(wasm: WasmExports): Int32Array {
  if (cachedInt32 === null || cachedInt32.byteLength === 0) {
    cachedInt32 = new Int32Array(wasm.memory.buffer);
  }
  return cachedInt32;
}

export function passArray8ToWasm(
  wasm: WasmExports,
  arg: Uint8Array
): [number, number] {
  const ptr = wasm.__wbindgen_malloc(arg.length, 1) >>> 0;
  getUint8(wasm).set(arg, ptr);
  WASM_VECTOR_LEN = arg.length;
  return [ptr, WASM_VECTOR_LEN];
}

export function passStringToWasm(
  wasm: WasmExports,
  arg: string
): [number, number] {
  let len = arg.length;
  let ptr = wasm.__wbindgen_malloc(len, 1) >>> 0;
  const mem = getUint8(wasm);
  let offset = 0;

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7f) break;
    mem[ptr + offset] = code;
  }

  if (offset !== len) {
    if (offset !== 0) arg = arg.slice(offset);
    ptr =
      wasm.__wbindgen_realloc(ptr, len, (len = offset + arg.length * 3), 1) >>>
      0;
    const view = getUint8(wasm).subarray(ptr + offset, ptr + len);
    const ret = encoder.encodeInto(arg, view);
    offset += ret.written!;
    ptr = wasm.__wbindgen_realloc(ptr, len, offset, 1) >>> 0;
  }

  WASM_VECTOR_LEN = offset;
  return [ptr, WASM_VECTOR_LEN];
}

function getStringFromWasm(wasm: WasmExports, ptr: number, len: number) {
  ptr = ptr >>> 0;
  return decoder.decode(getUint8(wasm).subarray(ptr, ptr + len));
}

// ---------------------------------------------------------------------------
// Typed wrappers for each WASM export
// ---------------------------------------------------------------------------

export function initPagefind(wasm: WasmExports, metaBytes: Uint8Array): number {
  const [ptr, len] = passArray8ToWasm(wasm, metaBytes);
  return wasm.init_pagefind(ptr, len) >>> 0;
}

export function setRankingWeights(
  wasm: WasmExports,
  ptr: number,
  weights: string
): number {
  const [sPtr, sLen] = passStringToWasm(wasm, weights);
  return wasm.set_ranking_weights(ptr, sPtr, sLen) >>> 0;
}

export function loadIndexChunk(
  wasm: WasmExports,
  ptr: number,
  chunkBytes: Uint8Array
): number {
  const [cPtr, cLen] = passArray8ToWasm(wasm, chunkBytes);
  return wasm.load_index_chunk(ptr, cPtr, cLen) >>> 0;
}

export function loadFilterChunk(
  wasm: WasmExports,
  ptr: number,
  chunkBytes: Uint8Array
): number {
  const [cPtr, cLen] = passArray8ToWasm(wasm, chunkBytes);
  return wasm.load_filter_chunk(ptr, cPtr, cLen) >>> 0;
}

export function addSyntheticFilter(
  wasm: WasmExports,
  ptr: number,
  filter: string
): number {
  const [fPtr, fLen] = passStringToWasm(wasm, filter);
  return wasm.add_synthetic_filter(ptr, fPtr, fLen) >>> 0;
}

/**
 * Returns a space-separated list of chunk hashes needed for the given query.
 */
export function requestIndexes(
  wasm: WasmExports,
  ptr: number,
  query: string
): string {
  let d0: number, d1: number;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const [sPtr, sLen] = passStringToWasm(wasm, query);
    wasm.request_indexes(retptr, ptr, sPtr, sLen);
    d0 = getInt32(wasm)[retptr / 4];
    d1 = getInt32(wasm)[retptr / 4 + 1];
    return getStringFromWasm(wasm, d0, d1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_free(d0!, d1!, 1);
  }
}

export function requestFilterIndexes(
  wasm: WasmExports,
  ptr: number,
  filters: string
): string {
  let d0: number, d1: number;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const [sPtr, sLen] = passStringToWasm(wasm, filters);
    wasm.request_filter_indexes(retptr, ptr, sPtr, sLen);
    d0 = getInt32(wasm)[retptr / 4];
    d1 = getInt32(wasm)[retptr / 4 + 1];
    return getStringFromWasm(wasm, d0, d1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_free(d0!, d1!, 1);
  }
}

export function requestAllFilterIndexes(
  wasm: WasmExports,
  ptr: number
): string {
  let d0: number, d1: number;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.request_all_filter_indexes(retptr, ptr);
    d0 = getInt32(wasm)[retptr / 4];
    d1 = getInt32(wasm)[retptr / 4 + 1];
    return getStringFromWasm(wasm, d0, d1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_free(d0!, d1!, 1);
  }
}

export function getFilters(wasm: WasmExports, ptr: number): string {
  let d0: number, d1: number;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.filters(retptr, ptr);
    d0 = getInt32(wasm)[retptr / 4];
    d1 = getInt32(wasm)[retptr / 4 + 1];
    return getStringFromWasm(wasm, d0, d1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_free(d0!, d1!, 1);
  }
}

export function wasmSearch(
  wasm: WasmExports,
  ptr: number,
  query: string,
  filter: string,
  sort: string,
  exact: boolean
): string {
  let d0: number, d1: number;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const [qPtr, qLen] = passStringToWasm(wasm, query);
    const [fPtr, fLen] = passStringToWasm(wasm, filter);
    const [sPtr, sLen] = passStringToWasm(wasm, sort);
    wasm.search(retptr, ptr, qPtr, qLen, fPtr, fLen, sPtr, sLen, exact);
    d0 = getInt32(wasm)[retptr / 4];
    d1 = getInt32(wasm)[retptr / 4 + 1];
    return getStringFromWasm(wasm, d0, d1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_free(d0!, d1!, 1);
  }
}

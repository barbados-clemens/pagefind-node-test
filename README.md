# node-pagefind

A Node.js client for [Pagefind](https://pagefind.app/) search indexes. Reimplements pagefind's browser client using the WASM bindings directly, with zero external dependencies.

## Why

Pagefind's browser client (`pagefind.js`) cannot run in Node.js — it references `window` and `document`, and optional chaining doesn't help because those variables are undeclared (not just undefined). This module talks to the WASM layer directly, replacing browser APIs with Node.js built-ins:

- `zlib.gunzipSync` replaces the 200+ line custom inflate/gunzip
- `fetch` (global in Node 18+) replaces browser fetch
- `WebAssembly.instantiate` with `{ wbg: {} }` (zero imports)

## Usage

### Programmatic

```typescript
import { createSearchClient } from './src/index';

const client = await createSearchClient({
  basePath: 'https://nx.dev/docs/pagefind/',
});

const response = await client.search('webpack configuration');

for (const result of response.results.slice(0, 5)) {
  const data = await result.data();
  console.log(`${data.meta.title} — ${data.url}`);
}
```

### CLI

```bash
# Basic search
npx tsx src/cli.ts "webpack"

# Limit results
npx tsx src/cli.ts "react generators" --limit 5

# JSON output
npx tsx src/cli.ts "angular" --json

# Timing info
npx tsx src/cli.ts "webpack" --verbose
```

#### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--base-path <url>` | Pagefind index URL | `https://nx.dev/docs/pagefind/` |
| `--limit <n>` | Max results | `10` |
| `--json` | JSON output | `false` |
| `--verbose` | Show timing info | `false` |

## API

### `createSearchClient(options): Promise<PagefindSearchClient>`

Creates and initializes a search client.

**Options:**

| Property | Type | Description |
|----------|------|-------------|
| `basePath` | `string` | URL to the pagefind directory (must contain `pagefind-entry.json`) |
| `excerptLength` | `number` | Words per excerpt (default: `30`) |
| `ranking` | `object` | Custom ranking weights (`termSimilarity`, `pageLength`, `termSaturation`, `termFrequency`) |

### `client.search(query, options?): Promise<SearchResponse>`

**Options:**

| Property | Type | Description |
|----------|------|-------------|
| `filters` | `Record<string, string[]>` | Filter results by facets |
| `sort` | `Record<string, 'asc' \| 'desc'>` | Sort results |
| `verbose` | `boolean` | Log timing to stderr |

**Response:**

```typescript
interface SearchResponse {
  results: SearchResult[];       // Lazy-loaded results
  unfilteredResultCount: number; // Total matches before filtering
  filters: Record<string, Record<string, number>>;
  totalFilters: Record<string, Record<string, number>>;
  timings: { preload: number; search: number; total: number };
}
```

Each `SearchResult` has a `data()` method that fetches and parses the full fragment on demand.

## File Structure

```
src/
  types.ts              # TypeScript interfaces
  wasm-bridge.ts        # WASM binding helpers (~50 lines of logic)
  pagefind-client.ts    # Search orchestration (fetch, decompress, search, excerpts)
  index.ts              # Public API
  cli.ts                # CLI interface
```

## Requirements

- Node.js 18+ (for global `fetch` and `WebAssembly`)
- `tsx` for running TypeScript directly

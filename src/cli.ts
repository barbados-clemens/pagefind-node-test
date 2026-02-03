#!/usr/bin/env npx tsx
/**
 * CLI for the Node.js Pagefind search client.
 *
 * Usage:
 *   npx tsx tools/node-pagefind/src/cli.ts <query> [options]
 *
 * Options:
 *   --base-path <url>  Pagefind base URL (default: https://nx.dev/docs/pagefind/)
 *   --limit <n>        Max results to show (default: 10)
 *   --json             Output as JSON
 *   --verbose          Show timing info
 */

import { createSearchClient } from './index';

interface CliArgs {
  query: string;
  basePath: string;
  limit: number;
  json: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const opts: CliArgs = {
    query: '',
    basePath: 'https://nx.dev/docs/pagefind/',
    limit: 10,
    json: false,
    verbose: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--base-path':
        opts.basePath = args[++i];
        break;
      case '--limit':
        opts.limit = parseInt(args[++i], 10);
        break;
      case '--json':
        opts.json = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(`Usage: npx tsx tools/node-pagefind/src/cli.ts <query> [options]

Options:
  --base-path <url>  Pagefind base URL (default: https://nx.dev/docs/pagefind/)
  --limit <n>        Max results to show (default: 10)
  --json             Output as JSON
  --verbose          Show timing info`);
        process.exit(0);
        break;
      default:
        positional.push(args[i]);
    }
  }

  opts.query = positional.join(' ');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.query) {
    console.error('Error: No search query provided. Use --help for usage.');
    process.exit(1);
  }

  const startTime = Date.now();

  const client = await createSearchClient({
    basePath: opts.basePath,
  });

  if (opts.verbose) {
    console.error(`Initialized in ${Date.now() - startTime}ms`);
  }

  const response = await client.search(opts.query, {
    verbose: opts.verbose,
  });

  const limited = response.results.slice(0, opts.limit);

  // Resolve all fragment data
  const resolved = await Promise.all(
    limited.map(async (r) => {
      const data = await r.data();
      return {
        id: r.id,
        score: r.score,
        title: data.meta.title,
        url: data.url,
        excerpt: data.excerpt,
        sub_results: data.sub_results.map((sr) => ({
          title: sr.title,
          url: sr.url,
          excerpt: sr.excerpt,
        })),
      };
    })
  );

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          query: opts.query,
          totalResults: response.unfilteredResultCount,
          timings: response.timings,
          results: resolved,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `\n${response.unfilteredResultCount} results for "${opts.query}"\n`
    );

    for (const result of resolved) {
      console.log(`  ${result.title}`);
      console.log(`  ${result.url}`);
      console.log(`  Score: ${result.score.toFixed(4)}`);

      if (result.sub_results.length > 1) {
        for (const sr of result.sub_results) {
          console.log(`    > ${sr.title}`);
          console.log(`      ${sr.url}`);
        }
      }
      console.log();
    }

    if (opts.verbose) {
      console.error(`Timings: ${JSON.stringify(response.timings)}`);
      console.error(`Total: ${Date.now() - startTime}ms`);
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

/**
 * Bundle Melange runtime into each trading-core JS file.
 *
 * Runs esbuild per-file so that bare `melange/*` and `melange.js/*` imports
 * are resolved and inlined, while inter-module `./` imports between
 * trading-core files are preserved as-is.
 *
 * Usage: node scripts/bundle-trading-core.mjs
 */

import { build } from 'esbuild';
import { readdir, rm, access, chmod } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';

const LIB_DIR = resolve('trading-core-js/trading-core/lib');
const NODE_MODULES = resolve('trading-core-js/node_modules');

/** Recursively collect all .js files under a directory. */
async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const entryPoints = await collectJsFiles(LIB_DIR);
  console.log(`[bundle] Found ${entryPoints.length} JS files to bundle`);

  // Make files writable (Dune output is read-only, cp -r preserves this)
  for (const f of entryPoints) {
    await chmod(f, 0o644);
  }

  // Normalize entry point paths for fast lookup
  const entrySet = new Set(entryPoints.map(f => resolve(f)));

  /**
   * Plugin: externalize relative imports ONLY when the importer is a
   * trading-core entry point. Melange runtime files use relative imports
   * internally (e.g., float.js → ./stdlib.js) which must be resolved.
   */
  const externalizeSiblings = {
    name: 'externalize-sibling-imports',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        const importerPath = resolve(args.resolveDir, args.importer || '');
        // Only externalize if the importer is one of our entry point files
        if (entrySet.has(resolve(args.importer)) || entrySet.has(importerPath)) {
          return { path: args.path, external: true };
        }
        // Let esbuild resolve normally (melange runtime internal imports)
        return undefined;
      });
    },
  };

  await build({
    entryPoints,
    bundle: true,
    format: 'esm',
    outdir: LIB_DIR,
    allowOverwrite: true,
    nodePaths: [NODE_MODULES],
    plugins: [externalizeSiblings],
    logLevel: 'warning',
  });

  console.log('[bundle] All files bundled successfully');

  // Verify no bare melange imports remain
  const { execSync } = await import('node:child_process');
  try {
    const result = execSync(
      `grep -r "from \\"melange" "${LIB_DIR.replace(/\\/g, '/')}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    if (result.trim()) {
      console.error('[bundle] ERROR: bare melange imports still present:');
      console.error(result);
      process.exit(1);
    }
  } catch {
    // grep returns exit code 1 when no matches — that's success
  }
  console.log('[bundle] Verified: no bare melange imports remain');

  // Clean up node_modules (runtime now inlined)
  try {
    await access(NODE_MODULES);
    await rm(NODE_MODULES, { recursive: true, force: true });
    console.log('[bundle] Removed trading-core-js/node_modules/');
  } catch {
    // Already removed or doesn't exist
  }

  console.log('[bundle] Done');
}

main().catch((err) => {
  console.error('[bundle] Failed:', err);
  process.exit(1);
});

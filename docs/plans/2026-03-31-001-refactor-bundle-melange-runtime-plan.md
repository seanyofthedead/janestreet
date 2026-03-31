---
title: "refactor: Bundle Melange runtime into self-contained trading-core-js output"
type: refactor
status: completed
date: 2026-03-31
deepened: 2026-03-31
---

# Bundle Melange Runtime into Self-Contained trading-core-js Output

## Overview

Add an esbuild post-processing step to the OCaml build pipeline so that every JS file in `trading-core-js/trading-core/lib/` ships with its Melange runtime dependencies resolved and inlined. This eliminates the bare `melange/*` import resolution failures that currently prevent the risk engine from executing orders.

## Problem Frame

Melange compiles OCaml to ESM JavaScript with bare module specifiers like `from "melange/float.js"` and `from "melange.js/caml.js"`. These resolve within `trading-core-js/node_modules/` (where Dune places the runtime), but fail when the engine imports the files via relative paths from the project root. Node's module resolution walks up from the importing file and never finds `melange/` in the root `node_modules/`.

This is the sole remaining blocker preventing the signal-to-order pipeline from working. Signals flow, conflict resolution works, but the risk engine crashes on `Stdlib__Float.min is not a function` and `Stdlib__List.fold_left is not a function` because the Melange stdlib modules don't resolve.

Two files (`risk.js`, `signal.js`) have been manually patched with inline JS shims. This is fragile — any OCaml rebuild overwrites the patches, and 11 other files still have unresolved bare imports that will fail when their code paths are hit.

## Requirements Trace

- R1. Every JS file in `trading-core-js/trading-core/lib/` must be self-contained — no bare `melange/*` or `melange.js/*` imports remaining
- R2. Inter-module imports between trading-core files (e.g., `from "./money.js"`) must be preserved as-is so the engine can import individual modules
- R3. The build script (`scripts/build-ocaml.sh`) must produce ready-to-use output in a single `npm run build:ocaml` invocation
- R4. The manual patches in `risk.js` and `signal.js` must be removed — the bundling step replaces them
- R5. Existing engine imports (`import * as Risk from '../../trading-core-js/trading-core/lib/risk.js'`) must continue working without changes
- R6. TypeScript declaration files (`.d.ts`) in trading-core-js must be preserved unchanged

## Scope Boundaries

- This plan does NOT change any OCaml source code, Dune configuration, or Melange version
- This plan does NOT change how the engine imports trading-core modules
- This plan does NOT add trading-core-js as an npm workspace
- This plan does NOT introduce a new build tool — esbuild is already available as a transitive dependency

## Context & Research

### Relevant Code and Patterns

- **Build script**: `scripts/build-ocaml.sh` — copies Dune output from WSL2 `_build/` to Windows `trading-core-js/`
- **Dune emit stanza**: `trading-core/dune` — `(melange.emit)` with `(module_systems esm)` targeting `trading-core-js`
- **Compiled output**: 24 JS files — 19 in `trading-core-js/trading-core/lib/` and 5 in `trading-core-js/trading-core/lib/signals/` (mean_reversion.js, momentum.js, market_making.js, calendar_seasonal.js, sector_rotation.js). The signals subdirectory files use `../` imports to reach sibling modules and also contain bare melange imports
- **Melange runtime**: `trading-core-js/node_modules/melange/` (68 stdlib files) and `trading-core-js/node_modules/melange.js/` (67 low-level runtime files) — bare directories, not npm packages
- **Engine consumers**: `engine/src/orchestrator.ts`, `engine/src/strategy-runner.ts`, `engine/src/conflict-resolver.ts`, `engine/src/performance-tracker.ts` — all use relative imports like `../../trading-core-js/trading-core/lib/risk.js`
- **esbuild availability**: installed as transitive dep of Vitest, available at `node_modules/.bin/esbuild`

### Unique Bare Imports Used

From `melange/` (stdlib): `float.js`, `list.js`, `array.js`, `string.js`, `int.js`, `printf.js`, `stdlib.js`

From `melange.js/` (runtime): `caml.js`, `caml_array.js`, `curry.js`

These 10 files have their own transitive dependencies within the runtime tree, but esbuild will resolve the full graph automatically.

## Key Technical Decisions

- **esbuild per-file bundling, not a single mega-bundle**: Each trading-core module gets bundled individually with its Melange deps inlined, but inter-module `./` imports are kept external. This preserves the current import pattern where the engine imports individual modules. A single-entry-point bundle would require changing all engine imports to use a barrel file.

- **Plugin-based externalization, scoped by importer**: esbuild's `external` wildcard `*` does not cross `/` boundaries, and using `--external:./*.js` on relative paths causes output path rewriting ([esbuild#1958](https://github.com/evanw/esbuild/issues/1958)). The correct approach is an esbuild `onResolve` plugin — but it **must not** blanket-externalize all `./` imports. The melange runtime files use relative imports internally (e.g., `float.js` imports `./stdlib.js`, `./list.js`). A blanket match would externalize those, producing broken output where `./stdlib.js` resolves to a nonexistent file in the trading-core lib directory. The plugin must check `args.importer`: only externalize relative imports when the importer is a trading-core entry point file, not when it's a melange runtime file being resolved as a dependency.

- **`nodePaths` for Melange resolution**: Use esbuild's `nodePaths` option pointing at `trading-core-js/node_modules/`. This adds the directory to the module resolution search path, so bare specifiers like `melange/float.js` and `melange.js/caml.js` resolve naturally. Package names with dots (like `melange.js`) are safe — esbuild classifies bare specifiers purely by checking if they start with `/`, `./`, or `../`, not by extension. The `nodePaths` limitation with `package.json` `exports` fields ([esbuild#2752](https://github.com/evanw/esbuild/issues/2752)) does not apply here since these are direct file paths, not `exports`-gated subpaths.

- **`alias` as fallback for `melange.js`**: If `nodePaths` fails to resolve `melange.js/` specifiers for any reason, esbuild's `alias` option can map `melange.js` to the correct directory. The alias handles subpath imports automatically: `alias: { 'melange.js': './trading-core-js/node_modules/melange.js' }` makes `melange.js/caml.js` resolve to `./trading-core-js/node_modules/melange.js/caml.js` relative to `absWorkingDir`.

- **Bundle runs on Windows (not WSL2)**: The build script runs OCaml in WSL2, then copies to Windows. The esbuild step runs on the Windows side because: (a) esbuild is in the Windows node_modules, (b) output files are on the Windows filesystem, (c) avoids WSL2/Windows path issues. WSL2 can invoke Windows Node via `cmd.exe /c node ...` natively through Windows interop.

- **Overwrite in-place**: Bundle each file and write the output back to the same path. The raw Dune output is not needed after bundling — the WSL2 `_build/` directory serves as the source of truth.

## Open Questions

### Resolved During Planning

- **Q: Should we use a single bundle or per-file?** Per-file. The engine imports 7 individual modules; a single bundle would require a barrel file and changing all import paths. Per-file bundling is zero-change to consumers.

- **Q: Where should esbuild run — WSL2 or Windows?** Windows, after the copy step. esbuild is in the Windows node_modules and the target files are on the Windows filesystem.

- **Q: Should we add esbuild as an explicit dependency?** No. It's already available via Vitest. If it ever disappears, the build script will fail loudly and we can add it then. Avoid unnecessary dependency churn.

### Resolved During Deepening

- **Q: Does esbuild handle the `melange.js/` bare specifier correctly?** Yes. esbuild classifies import paths as bare specifiers (package paths) purely by checking that they do NOT start with `/`, `./`, or `../`. The `.js` in the package name does not confuse it. `melange.js/caml.js` is treated as a subpath of package `melange.js`, same as `socket.io/client`. (Source: esbuild API docs, bare specifier classification rules)

- **Q: Can `--external:./*.js` keep relative imports external?** No. esbuild's wildcard `*` in external does not cross `/` boundaries, and relative-path externals cause output path rewriting. An `onResolve` plugin is the correct approach. (Source: [esbuild#1958](https://github.com/evanw/esbuild/issues/1958), [esbuild#406](https://github.com/evanw/esbuild/issues/406))

### Deferred to Implementation

- **Q: Does `nodePaths` or `alias` work better in practice for this setup?** `nodePaths` is simpler and should work. If it doesn't, `alias` is the fallback. Try `nodePaths` first during implementation; only switch to `alias` if resolution fails.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Build pipeline (current):
  WSL2: dune build @melange
    → _build/default/trading-core/trading-core-js/
  Copy to Windows:
    → trading-core-js/trading-core/lib/*.js  (bare melange imports)
    → trading-core-js/node_modules/melange/  (runtime files)

Build pipeline (proposed):
  WSL2: dune build @melange
    → _build/default/trading-core/trading-core-js/
  Copy to Windows:
    → trading-core-js/trading-core/lib/*.js  (bare melange imports)
    → trading-core-js/node_modules/melange/  (runtime files)
  Bundle on Windows via cmd.exe /c (NEW):
    esbuild.build({
      entryPoints: [all .js files in lib/ and lib/signals/ — recursive glob],
      bundle: true,
      format: 'esm',
      outdir: 'trading-core-js/trading-core/lib',
      allowOverwrite: true,
      nodePaths: ['trading-core-js/node_modules'],
      plugins: [externalize-sibling-imports plugin],
    })
    → trading-core-js/trading-core/lib/*.js       (self-contained)
    → trading-core-js/trading-core/lib/signals/*.js (self-contained)
    Clean up:
      rm trading-core-js/node_modules/  (no longer needed)
```

The `externalize-sibling-imports` plugin uses `onResolve` with an `args.importer` check: only externalize `./` and `../` imports when the importer is a trading-core entry point file, NOT when it's a melange runtime file being inlined. This is critical because melange runtime files use relative imports internally (e.g., `float.js` → `./stdlib.js`) which must be resolved and bundled, not externalized.

esbuild's `allowOverwrite: true` safely writes output to the same paths as input since it reads all entry points into memory first. This eliminates the temp-dir atomic swap. The `outdir` matches the entry point root, and esbuild preserves the `signals/` subdirectory structure automatically.

## Implementation Units

- [x] **Unit 1: Create the bundling script**

  **Goal:** Add a Node.js script that runs esbuild on each trading-core-js module to resolve bare Melange imports.

  **Requirements:** R1, R2, R3

  **Dependencies:** None

  **Files:**
  - Create: `scripts/bundle-trading-core.mjs`
  - Test: manual — run the script and verify output

  **Approach:**
  - Write a small Node script (not bash) for Windows compatibility and better error handling
  - Use esbuild's JS API (`esbuild.build()`) rather than CLI for programmatic control
  - Collect all `.js` files recursively under `trading-core-js/trading-core/lib/` (including `lib/signals/` — 24 files total, not 19)
  - Use a single `esbuild.build()` call with `entryPoints` array, `outdir: 'trading-core-js/trading-core/lib'`, `format: 'esm'`, `bundle: true`, `allowOverwrite: true`
  - Set `nodePaths: ['trading-core-js/node_modules']` to resolve bare `melange/*` and `melange.js/*` specifiers
  - Register an `onResolve` plugin that externalizes relative imports **only when the importer is a trading-core entry point file**. The plugin must check `args.importer` against the set of entry point paths. When the importer is a melange runtime file (being inlined as a dependency), relative imports must NOT be externalized — melange files like `float.js` import `./stdlib.js` internally, and these must be resolved and bundled in
  - If `nodePaths` fails to resolve `melange.js/` specifiers (unlikely per research), fall back to `alias: { 'melange.js': './trading-core-js/node_modules/melange.js' }`
  - `allowOverwrite: true` is safe because esbuild reads all inputs into memory before writing. This eliminates the need for a temp directory. esbuild preserves the `signals/` subdirectory structure automatically
  - Delete `trading-core-js/node_modules/` after bundling since the runtime is now inlined
  - Preserve `.d.ts` files untouched (esbuild only processes the `.js` entry points)

  **Patterns to follow:**
  - `scripts/setup-tables.mjs` — existing `.mjs` script pattern in the project

  **Test scenarios:**
  - After running: no `.js` file in `trading-core-js/trading-core/lib/` or `lib/signals/` contains `from "melange` or `from "melange.js`
  - After running: inter-module imports like `from "./money.js"` and `from "../symbol.js"` are preserved in output
  - After running: melange-internal relative imports (e.g., `float.js` → `./stdlib.js`) are NOT present in output (they were resolved and inlined)
  - After running: `lib/signals/` subdirectory and its 5 files still exist with correct structure
  - After running: `.d.ts` files are unchanged
  - After running: `trading-core-js/node_modules/` directory is removed
  - After running: engine can import and call `Risk.evaluate()`, `Signal.is_actionable()`, `Types.phase_of_equity()` without runtime errors

  **Verification:**
  - `grep -r 'from "melange' trading-core-js/trading-core/lib/` returns zero matches (recursive, covers signals/)
  - `grep -r 'from "./' trading-core-js/trading-core/lib/` returns only trading-core inter-module imports, not melange runtime internals
  - Engine starts and completes a full tick cycle without `Stdlib__*` errors

- [x] **Unit 2: Integrate bundling into the build pipeline**

  **Goal:** Wire the bundling script into `scripts/build-ocaml.sh` so `npm run build:ocaml` produces self-contained output end-to-end.

  **Requirements:** R3

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `scripts/build-ocaml.sh`

  **Approach:**
  - After the existing `cp -r` step, invoke the bundling script via Windows interop: `cmd.exe /c "cd /d C:\Users\peder\Documents\janestreet && node scripts\bundle-trading-core.mjs"`
  - This is necessary because `build-ocaml.sh` runs in WSL2 but esbuild and node_modules are on the Windows filesystem. WSL2 natively supports invoking Windows executables via `cmd.exe /c`. There is no existing precedent for this pattern in the codebase, but it is the natural extension — the script already writes to `/mnt/c/` paths
  - Note: `build-ocaml.sh` cannot run from Git Bash on Windows (it requires WSL2 for opam/dune), so the cross-environment invocation is the only viable path
  - Add a verification step after bundling that greps for remaining bare `melange` imports and fails the build if any are found

  **Patterns to follow:**
  - The existing `scripts/build-ocaml.sh` structure — sequential steps with echo status messages

  **Test scenarios:**
  - Running `npm run build:ocaml` from a clean state produces bundled output with no bare melange imports
  - Running `npm run build:ocaml` when esbuild is unavailable fails with a clear error message

  **Verification:**
  - Full `npm run build:ocaml` succeeds and the output passes the grep check

- [x] **Unit 3: Remove manual patches and verify end-to-end**

  **Goal:** Remove the hand-written JS shims from `risk.js` and `signal.js`, and restore the conflict resolver to use the OCaml `compare_priority` function.

  **Requirements:** R4, R5

  **Dependencies:** Unit 1, Unit 2

  **Files:**
  - Modify: `trading-core-js/trading-core/lib/risk.js` — revert manual patches (or simply re-run build:ocaml to regenerate)
  - Modify: `trading-core-js/trading-core/lib/signal.js` — revert manual patches (or simply re-run build:ocaml to regenerate)
  - Modify: `engine/src/conflict-resolver.ts` — restore OCaml `Signal.compare_priority` call
  - Test: `engine/test/` — run existing test suite

  **Approach:**
  - Re-run `npm run build:ocaml` which will overwrite the patched files with freshly built + bundled versions
  - In `conflict-resolver.ts`, change the native JS sort back to `Signal.compare_priority(a, b)` since the Melange runtime will now be bundled
  - Run the engine test suite to verify no regressions

  **Patterns to follow:**
  - Existing conflict resolver pattern before manual patching

  **Test scenarios:**
  - `risk.js` contains no `// Patched:` comments
  - `signal.js` contains no `// Patched:` comments
  - Conflict resolver uses `Signal.compare_priority` not inline sort
  - Engine test suite passes
  - Engine starts, generates signals, passes risk checks, and submits orders without `Stdlib__*` errors

  **Verification:**
  - `npm test --workspace=engine` passes
  - Engine completes a full trading tick: signal generation → conflict resolution → risk evaluation → order submission (or risk rejection with a logged reason)

## System-Wide Impact

- **Interaction graph:** Only the build pipeline changes. No runtime code changes except removing the manual patches and restoring the conflict resolver.
- **Error propagation:** If esbuild fails during build, the pipeline fails loudly before producing output. No partial states.
- **State lifecycle risks:** None. The bundling is a pure build-time transformation.
- **API surface parity:** The engine's imports and the modules' exports are unchanged. The only difference is that Melange runtime code is inlined rather than imported.
- **Integration coverage:** The engine test suite covers the critical path. A manual smoke test of a full trading tick (signals → orders) confirms end-to-end.

## Risks & Dependencies

- **`melange.js/` specifier resolution** — Resolved during deepening: esbuild treats `melange.js` as a package name (not a file path) because it doesn't start with `/`, `./`, or `../`. `nodePaths` will resolve it. If it doesn't, `alias` is a tested fallback. Risk is low.
- **WSL2-to-Windows interop** — `cmd.exe /c node ...` is the first cross-platform invocation in the codebase. Risk: path encoding issues or Node version mismatch between WSL2's view and Windows. Mitigation: the bundling script uses `process.cwd()`-relative paths and the Windows-installed Node, avoiding `/mnt/c/` path confusion.
- **esbuild version drift** — Currently a transitive dep of Vitest. If Vitest upgrades or removes it, the build breaks. Mitigation: the error is loud and obvious; add `esbuild` as an explicit devDependency if this happens.
- **Bundle size increase** — Each module will include its own copy of any shared Melange runtime code. For 19 small modules this is negligible (the entire Melange runtime is ~200KB unminified). Not worth optimizing.
- **OCaml rebuild overwrites** — This is the desired behavior. Every `npm run build:ocaml` produces a fresh build from OCaml source, then bundles. No stale manual patches can persist.

## Sources & References

- Related code: `scripts/build-ocaml.sh`, `trading-core/dune` (melange.emit stanza)
- Related issue: Melange runtime resolution failures blocking order execution (this session)
- esbuild API docs: `nodePaths`, `alias`, `external`, plugin `onResolve` API
- [esbuild#1958](https://github.com/evanw/esbuild/issues/1958) — `external:./node_modules/*` causes relative path rewriting in output
- [esbuild#406](https://github.com/evanw/esbuild/issues/406) — wildcard external pattern behavior and limitations
- [esbuild#2752](https://github.com/evanw/esbuild/issues/2752) — `nodePaths` ignores `package.json` `exports` field (not relevant here since we use direct file paths)

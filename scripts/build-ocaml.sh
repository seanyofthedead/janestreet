#!/bin/bash
# Build OCaml/Melange trading core and copy JS output to Windows project
# Usage: bash scripts/build-ocaml.sh
# Or from WSL2: bash /mnt/c/Users/peder/Documents/janestreet/scripts/build-ocaml.sh

set -euo pipefail

WSL_PROJECT="$HOME/janestreet"
WINDOWS_OUT="/mnt/c/Users/peder/Documents/janestreet/trading-core-js"

export PATH="$HOME/bin:$PATH"
eval $(opam env)

echo "[build-ocaml] Building Melange output..."
cd "$WSL_PROJECT"
dune build @melange 2>&1

echo "[build-ocaml] Copying JS output..."
rm -rf "$WINDOWS_OUT"
mkdir -p "$WINDOWS_OUT"
cp -r "$WSL_PROJECT/_build/default/trading-core/trading-core-js/"* "$WINDOWS_OUT/"

echo "[build-ocaml] Bundling Melange runtime into JS output..."
cmd.exe /c "cd /d C:\Users\peder\Documents\janestreet && node scripts\bundle-trading-core.mjs" 2>&1
if [ $? -ne 0 ]; then
  echo "[build-ocaml] ERROR: bundling failed"
  exit 1
fi

# Verify no bare melange imports remain
if grep -r 'from "melange' "$WINDOWS_OUT/trading-core/lib/" 2>/dev/null; then
  echo "[build-ocaml] ERROR: bare melange imports still present after bundling"
  exit 1
fi

echo "[build-ocaml] Build complete. Files:"
find "$WINDOWS_OUT/trading-core" -name "*.js" -type f 2>/dev/null

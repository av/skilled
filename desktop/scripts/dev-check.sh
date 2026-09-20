#!/bin/sh
# Typecheck + bundle the UI, then build the Tauri debug binary. Used locally and by the e2e test.
set -e
cd "$(dirname "$0")/.."
bunx tsc --noEmit
bun run scripts/build.ts
cd src-tauri
cargo build 2>&1 | grep -E '^(warning|error)' -A6 | head -40 || true
test -x target/debug/skilled-desktop && echo "debug binary: $(date -r target/debug/skilled-desktop '+%H:%M:%S')"

#!/bin/sh
set -e

if command -v cargo >/dev/null 2>&1; then
  echo "Building skilled-index (Rust)..."
  cargo build --release --manifest-path index/Cargo.toml
  cp index/target/release/skilled-index .
else
  echo "WARNING: cargo not found, skipping skilled-index build."
  echo "  Install: https://rustup.rs"
fi

echo "Building skilled (TypeScript/Bun)..."
bun build --compile src/main.ts --outfile skilled

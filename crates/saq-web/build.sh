#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

TARGET=wasm32-unknown-unknown
PROFILE=release

echo "==> cargo build --target $TARGET --$PROFILE"
cargo build --$PROFILE --target "$TARGET"

echo "==> copying module into static/"
cp "target/$TARGET/$PROFILE/saq_web.wasm" static/saq.wasm
ls -l static/saq.wasm

if [ "${1:-}" = "serve" ]; then
  echo "==> serving static/ on http://localhost:8000"
  echo "    (any static server works; Range requests are not needed)"
  cd static
  exec python3 -m http.server "${2:-8000}"
fi

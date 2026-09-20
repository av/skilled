#!/bin/sh
# Launch the debug build against a fixture $HOME in e2e mode and collect
# screenshots (+ optional recording assembled from in-app webview frames).
#
#   scripts/capture.sh                 # fixture-now (≈600 calls spread over 16 weeks) -> docs/*.png
#   scripts/capture.sh --record        # also writes docs/tour.mp4 + docs/tour.gif (needs ffmpeg)
#   FIXTURE=tests/fixtures/home scripts/capture.sh   # use the small committed fixture
set -e
cd "$(dirname "$0")/.."
#   SKILLED_E2E_BIN=src-tauri/target/release/skilled-desktop scripts/capture.sh --record   # record the release build
BIN=${SKILLED_E2E_BIN:-src-tauri/target/debug/skilled-desktop}
test -x "$BIN" || { echo "build first: scripts/dev-check.sh (or bun run tauri build --no-bundle)"; exit 1; }

FIXTURE=${FIXTURE:-tests/fixtures/home-now}
if [ "$FIXTURE" = "tests/fixtures/home-now" ]; then
  bun run scripts/make-fixture.ts --large 600 --out tests/fixtures/home-now >/dev/null
fi
OUT=$(mktemp -d)
CFG=$(mktemp -d)
# The app writes ~/.skilled/index.db into $HOME: use a throwaway copy of the fixture.
cp -r "$FIXTURE" "$OUT/home"
# Screenshots use the dark theme (the TUI's native look) regardless of the host OS setting.
printf '{"theme":"%s"}\n' "${THEME:-dark}" > "$CFG/settings.json"

RECORD=0
[ "$1" = "--record" ] && RECORD=1

env HOME="$OUT/home" XDG_CONFIG_HOME="$CFG" SKILLED_CONFIG_DIR="$CFG" SKILLED_E2E_DIR="$OUT" \
    SKILLED_E2E_DWELL_MS=${DWELL:-1400} SKILLED_E2E_RECORD=$RECORD "$BIN"

mkdir -p docs
for v in dashboard detail activity audit providers settings live; do
  cp "$OUT/$v.png" docs/
done
cp "$OUT/report.json" docs/e2e-report.json
echo "screenshots: docs/*.png  report: docs/e2e-report.json"

if [ "$RECORD" = 1 ]; then
  # The app snapshots its own webview at 10 fps during the tour (works on any
  # compositor and in CI); assemble the frames here. H.264 via libx264 when
  # available, else libopenh264 (Fedora's ffmpeg); GIF always.
  N=$(ls "$OUT/frames" | wc -l)
  ENC=libx264; ffmpeg -hide_banner -encoders 2>/dev/null | grep -q ' libx264 ' || ENC=libopenh264
  ffmpeg -y -loglevel error -framerate 10 -pattern_type glob -i "$OUT/frames/*.png" \
    -vf "scale=1280:-2:flags=lanczos,format=yuv420p" -c:v "$ENC" -b:v 1500k -movflags +faststart docs/tour.mp4 || echo "mp4 encode failed (encoder $ENC)"
  ffmpeg -y -loglevel error -framerate 10 -pattern_type glob -i "$OUT/frames/*.png" \
    -vf "fps=5,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer" docs/tour.gif
  echo "recording: docs/tour.mp4 ($(du -h docs/tour.mp4 2>/dev/null | cut -f1), $N frames), docs/tour.gif ($(du -h docs/tour.gif | cut -f1))"
fi
rm -rf "$OUT" "$CFG"

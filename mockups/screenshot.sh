#!/usr/bin/env bash
# Regenerate the README/Marketplace screenshot using Chrome headless.
# Run from anywhere:  bash mockups/screenshot.sh
# Resolves paths relative to this script's parent (the extension root), so it
# works regardless of CWD.
#
#   images/screenshot.png — the Activity Bar configuration drawer (accordion)

set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Extract the real webview HTML verbatim from src/webview/configViewProvider.ts
# (see mockups/extract-webview.js) so the screenshot can never silently drift
# from what actually ships; only the sample state it's populated with is mockup data.
node mockups/extract-webview.js

"$CHROME" \
  --headless=new \
  --disable-gpu \
  --screenshot=images/screenshot.png \
  --window-size=620,760 \
  --default-background-color=ff1e1e1e \
  --force-device-scale-factor=2 \
  "file://$(pwd)/mockups/screenshot.html"

echo "Wrote images/screenshot.png (configuration drawer)"

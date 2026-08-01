#!/usr/bin/env bash
# Prints the path to a pre-installed Chromium executable suitable for
# Playwright's launchOptions.executablePath, if one exists in this
# environment. Prints nothing and exits 1 if none is found — that means
# this environment probably doesn't have the pre-installed-browser gotcha
# and `npx playwright install chromium` should be used instead.
set -euo pipefail

CANDIDATES=(
  "/opt/pw-browsers/chromium"
  "/opt/pw-browsers/chromium/chrome-linux/chrome"
)

for candidate in "${CANDIDATES[@]}"; do
  if [ -x "$candidate" ]; then
    echo "$candidate"
    exit 0
  fi
done

FOUND=$(find /opt/pw-browsers -maxdepth 3 -type f -iname "chrome" -perm -u+x 2>/dev/null | head -n 1 || true)
if [ -n "$FOUND" ]; then
  echo "$FOUND"
  exit 0
fi

exit 1

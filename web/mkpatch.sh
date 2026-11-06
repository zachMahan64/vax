#!/bin/bash
# Regenerate simh-web.patch from edits made in build/src (run before build.sh,
# which re-exports build/src from the submodule).
set -euo pipefail
cd "$(dirname "$0")"
ORIG=$(mktemp -d)
trap 'rm -rf "$ORIG"' EXIT
git -C ../simh archive HEAD | tar -x -C "$ORIG"
for f in sim_console.c sim_timer.c sim_serial.c; do
	diff -u --label "a/$f" --label "b/$f" "$ORIG/$f" "build/src/$f" || true
done > simh-web.patch
grep -c '^@@' simh-web.patch

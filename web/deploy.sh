#!/bin/bash
# Publish web/site/ to the gh-pages branch of this repo's origin (GitHub Pages)
# 
# - run ./web/build.sh first 
# - replaces whatever is on gh-pages
set -euo pipefail
cd "$(dirname "$0")"
SITE=$PWD/site

if [ ! -f "$SITE/index.html" ] || [ ! -f "$SITE/disk/manifest.json" ]; then
	echo "web/site/ is missing or incomplete; run ./web/build.sh first" >&2
	exit 1
fi

REMOTE=$(git remote get-url origin)
SOURCE=$(git rev-parse --short HEAD)

# commit a copy in a scratch repo, so web/site/ never gets a .git of its own
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R "$SITE"/. "$TMP"
touch "$TMP/.nojekyll"
git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" commit -qm "Deploy site from $SOURCE"
git -C "$TMP" push -f "$REMOTE" gh-pages

echo "pushed to gh-pages on $REMOTE"

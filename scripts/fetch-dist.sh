#!/bin/sh
# Download the 4.3BSD distribution from TUHS and build the install tape.
set -e
cd "$(dirname "$0")/.."
BASE=https://www.tuhs.org/Archive/Distributions/UCB/4BSD/4.3BSD
cd dist
for f in stand miniroot rootdump; do
	[ -f "$f" ] || { curl -fsSLO "$BASE/$f.gz" && gunzip -f "$f.gz"; }
done
for f in srcsys usr vfont src new ingres; do
	[ -f "$f.tar" ] || { curl -fsSLO "$BASE/$f.tar.gz" && gunzip -f "$f.tar.gz"; }
done
[ -f boot42 ] || uudecode -o boot42 boot42.uue
cd ..
python3 scripts/mktape.py dist dist/43.tap

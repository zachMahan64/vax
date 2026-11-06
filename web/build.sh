#!/bin/bash
# Build the browser version of Nancy into web/site/ (a static, serverless site).
#
#   1. Export the pinned simh sources and apply simh-web.patch.
#   2. Compile vax780 to WebAssembly with Emscripten.
#   3. Install a fresh 4.3BSD disk with the native simulator, split it into
#      chunk files the browser fetches on demand.
#   4. Copy the page, worker, and vendored xterm.js.
#   5. Boot it headlessly under Node to record which chunks the boot reads.
#
# Usage: build.sh [wasm|disk|site|bootset]...   (default: all four)
#
# Needs: emcc, python3, a built native simh/BIN/vax780, and ./scripts/fetch-dist.sh run.
set -euo pipefail
cd "$(dirname "$0")"
WEB=$PWD
ROOT=$(cd .. && pwd)
BUILD=$WEB/build
SITE=$WEB/site

XTERM_VERSION=5.5.0

step() { printf '\n== %s\n' "$*"; }

STAGES=${*:-wasm disk site bootset}
want() { [[ " $STAGES " == *" $1 "* ]]; }

if want wasm; then
step "simh sources"
rm -rf "$BUILD/src"
mkdir -p "$BUILD/src"
git -C "$ROOT/simh" archive HEAD | tar -x -C "$BUILD/src"
patch -s -p1 -d "$BUILD/src" < "$WEB/simh-web.patch"

step "compile vax780.wasm"
cd "$BUILD/src"
SIM_SRC="scp.c sim_console.c sim_fio.c sim_timer.c sim_sock.c sim_tmxr.c
	sim_ether.c sim_tape.c sim_disk.c sim_serial.c sim_video.c sim_imd.c
	sim_card.c"
# The vax780 source list, straight from simh's makefile
VAX780_SRC=$(tr -d '\r' < makefile | sed -n '/^VAX780 = /,/^VAX780_OPT/p' | grep -v '^VAX780_OPT' |
	sed 's/^VAX780 = //; s/\\//g; s/\${VAXD}/VAX/g; s/\${PDP11D}/PDP11/g')
mkdir -p "$SITE"
# shellcheck disable=SC2086
emcc -O3 -flto \
	-DVM_VAX -DVAX_780 -DUSE_INT64 -DUSE_ADDR64 -I . -I VAX -I PDP11 \
	-Wno-everything \
	$SIM_SRC $VAX780_SRC \
	-sENVIRONMENT=worker,node -sMODULARIZE=1 -sEXPORT_NAME=createVax \
	-sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=65536 \
	-sINITIAL_MEMORY=64MB -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1MB \
	-sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=1 \
	-sEXPORTED_RUNTIME_METHODS=FS,callMain \
	-o "$SITE/vax780.js"
cd "$WEB"
fi

if want disk; then
step "install fresh 4.3BSD disk"
DISKWORK=$BUILD/disk
rm -rf "$DISKWORK"
mkdir -p "$DISKWORK/machine"
cp "$ROOT"/machine/*.ini "$DISKWORK/machine/"
ln -s "$ROOT/dist" "$DISKWORK/dist"
ln -s "$ROOT/simh" "$DISKWORK/simh"
cp -R "$ROOT/scripts" "$DISKWORK/scripts"
"$DISKWORK/scripts/install.sh"

step "split disk into chunks"
rm -rf "$SITE/disk"
python3 -I "$WEB/mkchunks.py" "$DISKWORK/machine/nancy.dsk" "$SITE/disk"
fi

if want site; then
step "page, worker, xterm.js"
cp "$WEB"/src/* "$SITE/"
cp "$ROOT/dist/boot42" "$SITE/boot42"
mkdir -p "$SITE/vendor"
NPM=https://cdn.jsdelivr.net/npm
curl -fsSL "$NPM/@xterm/xterm@$XTERM_VERSION/lib/xterm.js" -o "$SITE/vendor/xterm.js"
curl -fsSL "$NPM/@xterm/xterm@$XTERM_VERSION/css/xterm.css" -o "$SITE/vendor/xterm.css"
fi

if want bootset; then
step "record boot chunk set"
node "$WEB/test/boot-test.js" --record "$SITE/disk/boot.json" > /dev/null
fi

step "done"
du -sh "$SITE"
echo "serve with: python3 -m http.server -d web/site 8780"

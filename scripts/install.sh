#!/bin/sh
# Install 4.3BSD onto a fresh machine/nancy.dsk (about a minute).
# Refuses to overwrite an existing disk unless run with -f.
set -e
cd "$(dirname "$0")/../machine"
if [ -f nancy.dsk ] && [ "$1" != "-f" ]; then
	echo "machine/nancy.dsk already exists; rerun with -f to wipe and reinstall" >&2
	exit 1
fi
rm -f nancy.dsk
cp ../dist/miniroot miniroot.work
../simh/BIN/vax780 install1.ini < /dev/null > install1.log 2>&1
rm -f miniroot.work
../simh/BIN/vax780 install2.ini < /dev/null > install2.log 2>&1
../simh/BIN/vax780 install3.ini < /dev/null > install3.log 2>&1
echo "installed; boot with ./run-vax.sh"

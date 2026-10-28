#!/bin/sh
# Boot "Nancy", the emulated VAX-11/780, into 4.3BSD.
cd "$(dirname "$0")/machine" && exec ../simh/BIN/vax780 boot.ini

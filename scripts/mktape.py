#!/usr/bin/env python3
"""Build a SIMH .tap image of the 4.3BSD distribution tape.

SIMH tape format: each record is <len:u32le><data><len:u32le>; a tape mark
is a zero u32. Short final records are zero-padded to the block size, which
matches the original maketape behavior.

Usage: mktape.py <dist_dir> <out.tap>
"""

import struct
import sys
from pathlib import Path

# order matters: the install procedure uses `mt fsf 3` to reach srcsys.tar.
FILES = [
    ("stand", 512),
    ("miniroot", 10240),
    ("rootdump", 10240),
    ("srcsys.tar", 10240),
    ("usr.tar", 10240),
    ("vfont.tar", 10240),
    ("src.tar", 10240),
    ("new.tar", 10240),
    ("ingres.tar", 10240),
]

TAPE_MARK = b"\x00\x00\x00\x00"


def main():
    dist, out = Path(sys.argv[1]), Path(sys.argv[2])
    with out.open("wb") as tape:
        for name, bs in FILES:
            with (dist / name).open("rb") as f:
                while block := f.read(bs):
                    block = block.ljust(bs, b"\x00")
                    hdr = struct.pack("<I", bs)
                    tape.write(hdr + block + hdr)
            tape.write(TAPE_MARK)
        tape.write(TAPE_MARK)  # double tape mark = end of medium
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Split a disk image into fixed-size chunk files for on-demand loading.

All-zero chunks are skipped (the browser synthesizes them), so only the ~50 MB
of a 456 MB RA81 image that BSD has actually written gets published.

Writes <out_dir>/manifest.json and <out_dir>/<index as 5 hex digits>.bin.

Usage: mkchunks.py <disk_image> <out_dir>
"""
import hashlib
import json
import sys
from pathlib import Path

CHUNK_SIZE = 64 * 1024


def main():
    image, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    chunks = []
    with image.open("rb") as f:
        index = 0
        while block := f.read(CHUNK_SIZE):
            digest.update(block)
            if block.count(0) != len(block):
                (out / f"{index:05x}.bin").write_bytes(block)
                chunks.append(index)
            index += 1
    manifest = {
        "size": image.stat().st_size,
        "chunkSize": CHUNK_SIZE,
        "version": digest.hexdigest()[:16],
        "chunks": chunks,
    }
    (out / "manifest.json").write_text(json.dumps(manifest))
    print(f"{len(chunks)} of {index} chunks, "
          f"{len(chunks) * CHUNK_SIZE / 1e6:.1f} MB, version {manifest['version']}")


if __name__ == "__main__":
    main()

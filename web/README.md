# Nancy in the browser

Do the native setup in the top-level README first. The build uses the native
simulator to install the disk.

```sh
brew install emscripten
./web/build.sh                             # output goes to web/site/
python3 -m http.server -d web/site 8780    # open http://localhost:8780/
```

To publish, upload the contents of `web/site/` to any static host. Opening
`index.html` directly from disk doesn't work.

## Files

- `src/index.html`: page text and layout
- `src/main.js`: terminals and buttons
- `src/worker.js`: runs the emulator and saves the disk in the browser
- `src/vaxhost.js`: console, disk, and boot code shared with the tests
- `src/boot.ini`: machine config
- `simh-web.patch`: SIMH changes, applied at build time
- `mkchunks.py`: splits the disk image into small files

## Tests

```sh
node web/test/boot-test.js
node web/test/browser-test.js http://127.0.0.1:8780/ /tmp/shots   # needs the server running
```

## Changing the patch

Run `./web/build.sh wasm`, edit `build/src/sim_*.c`, run `./web/mkpatch.sh`,
then build again.

## Host

```sh
./web/build.sh
./web/deploy.sh # force-pushes web/site/ to gh-pages branch on origin
```


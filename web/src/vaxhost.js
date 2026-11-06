// Host side of the browser VAX: console and terminal queues, chunked disk,
// and boot setup.
//
// Loaded by worker.js (importScripts) and by test/boot-test.js (require), so
// the headless test exercises the same code the page runs.  The C side is in
// simh-web.patch: it calls Module.simHost.{getchar,putchar,yield,sleep,readline}
// for the console and Module.simHost.{serialRead,serialWrite} for the extra
// terminals ("term0".."term7" serial ports, wired to DZ11 lines in boot.ini).
'use strict';

// Console traffic in both directions.  While the simulator runs, keystrokes
// queue for the emulated console port; while SCP waits at sim>, they go to a
// small line editor instead.  Extra terminals are plain byte queues.
class ConsoleHost {
  constructor(write, writeSerial) {
    this.write = write; // (Uint8Array) => void
    this.writeSerial = writeSerial; // (line, Uint8Array) => void
    this.input = [];
    this.output = [];
    this.serialIn = new Map(); // line => bytes typed, not yet read
    this.serialOut = new Map(); // line => bytes written, not yet flushed
    this.lineWaiter = null;
    this.line = '';
    // MessageChannel gives a zero-delay yield; setTimeout(0) clamps to 4 ms.
    this.wakers = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = () => this.wakers.shift()();
    this.port = channel.port2;
  }

  key(bytes) {
    for (const c of bytes) {
      if (this.lineWaiter) this.editLine(c);
      else this.input.push(c);
    }
  }

  editLine(c) {
    if (c === 0x0d || c === 0x0a) {
      const resolve = this.lineWaiter;
      const line = this.line;
      this.lineWaiter = null;
      this.line = '';
      this.emit('\r\n');
      resolve(line);
    } else if (c === 0x7f || c === 0x08) {
      if (this.line) {
        this.line = this.line.slice(0, -1);
        this.emit('\b \b');
      }
    } else if (c >= 0x20 && c < 0x7f) {
      this.line += String.fromCharCode(c);
      this.emit(String.fromCharCode(c));
    }
    this.flush();
  }

  emit(text) {
    for (let i = 0; i < text.length; i++) this.output.push(text.charCodeAt(i));
  }

  // Emulated console port output (the VAX's own terminal)
  getchar() {
    return this.input.length ? this.input.shift() : -1;
  }

  putchar(c) {
    this.output.push(c);
    if (this.output.length >= 8192) this.flush();
  }

  // SCP's own messages (stdout/stderr), which use bare \n
  stdout(c) {
    if (c === 0x0a) this.output.push(0x0d);
    this.output.push(c);
  }

  // Extra terminals (DZ11 lines)
  serialKey(line, bytes) {
    if (!this.serialIn.has(line)) this.serialIn.set(line, []);
    this.serialIn.get(line).push(...bytes);
  }

  serialRead(line, dst) {
    const queue = this.serialIn.get(line);
    if (!queue || !queue.length) return 0;
    const n = Math.min(queue.length, dst.length);
    dst.set(queue.splice(0, n));
    return n;
  }

  serialWrite(line, bytes) {
    if (!this.serialOut.has(line)) this.serialOut.set(line, []);
    this.serialOut.get(line).push(...bytes);
  }

  flush() {
    if (this.output.length) {
      this.write(Uint8Array.from(this.output));
      this.output.length = 0;
    }
    for (const [line, out] of this.serialOut) {
      if (!out.length) continue;
      this.writeSerial(line, Uint8Array.from(out));
      out.length = 0;
    }
  }

  yield() {
    this.flush();
    return new Promise((resolve) => {
      this.wakers.push(resolve);
      this.port.postMessage(0);
    });
  }

  sleep(ms) {
    this.flush();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  readline() {
    // Wait before flushing: whoever sees the prompt may answer immediately.
    const line = new Promise((resolve) => {
      this.lineWaiter = resolve;
    });
    this.flush();
    return line;
  }
}

// A disk image published as fixed-size chunk files (see mkchunks.py).  Chunks
// are fetched synchronously on first read, written chunks stay in memory, and
// the host persists `dirty` ones.  Chunks absent from the manifest are zeros.
class ChunkDisk {
  constructor(manifest, fetchChunkSync) {
    this.size = manifest.size;
    this.chunkSize = manifest.chunkSize;
    this.published = new Set(manifest.chunks);
    this.fetchChunkSync = fetchChunkSync; // (index) => Uint8Array
    this.chunks = new Map(); // index => Uint8Array
    this.dirty = new Set();
    this.fetchedBytes = 0;
  }

  // The chunk's contents, or null for an unwritten zero chunk.
  peek(index) {
    let chunk = this.chunks.get(index);
    if (!chunk && this.published.has(index)) {
      chunk = this.fetchChunkSync(index);
      this.fetchedBytes += chunk.length;
      this.chunks.set(index, chunk);
    }
    return chunk || null;
  }

  // Cache a chunk fetched ahead of time, unless it has been loaded meanwhile.
  offer(index, chunk) {
    if (!this.chunks.has(index)) {
      this.fetchedBytes += chunk.length;
      this.chunks.set(index, chunk);
    }
  }

  restore(index, chunk) {
    this.chunks.set(index, chunk);
  }

  read(dst, position) {
    const n = Math.max(0, Math.min(dst.length, this.size - position));
    for (let done = 0; done < n; ) {
      const index = Math.floor((position + done) / this.chunkSize);
      const start = (position + done) % this.chunkSize;
      const len = Math.min(n - done, this.chunkSize - start);
      const chunk = this.peek(index);
      if (chunk) dst.set(chunk.subarray(start, start + len), done);
      else dst.fill(0, done, done + len);
      done += len;
    }
    return n;
  }

  write(src, position) {
    for (let done = 0; done < src.length; ) {
      const index = Math.floor((position + done) / this.chunkSize);
      const start = (position + done) % this.chunkSize;
      const len = Math.min(src.length - done, this.chunkSize - start);
      let chunk = this.peek(index);
      if (!chunk) {
        chunk = new Uint8Array(this.chunkSize);
        this.chunks.set(index, chunk);
      }
      chunk.set(src.subarray(done, done + len), start);
      this.dirty.add(index);
      done += len;
    }
    this.size = Math.max(this.size, position + src.length);
    return src.length;
  }

  // Published chunks not yet in memory, in disk order.
  unfetched() {
    return [...this.published].filter((i) => !this.chunks.has(i)).sort((a, b) => a - b);
  }

  // Take the dirty chunks, as copies, for saving.
  takeDirty() {
    const entries = [...this.dirty].map((i) => [i, this.chunks.get(i).slice()]);
    this.dirty.clear();
    return entries;
  }
}

// Make `path` in Emscripten's MEMFS a file whose contents live in `disk`.
// MEMFS reports a file's size from node.usedBytes, and FS.open copies
// node.stream_ops onto the stream, so overriding both is enough.
function mountChunkDisk(FS, path, disk) {
  FS.writeFile(path, new Uint8Array(0));
  const node = FS.lookupPath(path).node;
  node.usedBytes = disk.size;
  node.stream_ops = Object.assign({}, node.stream_ops, {
    read(stream, buffer, offset, length, position) {
      return disk.read(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length), position);
    },
    write(stream, buffer, offset, length, position) {
      const n = disk.write(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length), position);
      node.usedBytes = disk.size;
      return n;
    },
  });
}

// Start the simulator.  `env` supplies the environment-specific pieces:
//   createVax                the Emscripten module factory
//   disk                     a ChunkDisk
//   bootIni, boot42          file contents for /machine
//   onOutput(Uint8Array)     console output
//   onSerial(line, Uint8Array)  output for an extra terminal
//   onExit(code)             SCP exited (quit)
// Returns the ConsoleHost; feed keystrokes to host.key() / host.serialKey().
async function startVax(env) {
  const host = new ConsoleHost(env.onOutput, env.onSerial || (() => {}));
  const Module = await env.createVax({
    noInitialRun: true,
    simHost: host,
    stdin: () => null,
    stdout: (c) => host.stdout(c),
    stderr: (c) => host.stdout(c),
    onExit: (code) => {
      host.flush();
      env.onExit(code);
    },
  });
  const FS = Module.FS;
  FS.mkdir('/machine');
  FS.chdir('/machine');
  FS.writeFile('boot.ini', env.bootIni);
  FS.writeFile('boot42', env.boot42);
  mountChunkDisk(FS, 'nancy.dsk', env.disk);
  Module.callMain(['boot.ini']);
  return host;
}

if (typeof module !== 'undefined') module.exports = { ConsoleHost, ChunkDisk, startVax };

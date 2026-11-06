// Web Worker that runs the VAX.  The page (main.js) sends keystrokes and
// receives terminal output.  Disk chunks come from disk/ on the same static
// host; chunks the VAX writes are kept in IndexedDB so they survive reloads.
'use strict';
importScripts('vaxhost.js', 'vax780.js');

const SAVE_INTERVAL_MS = 2000;
const BOOT_FETCH_CONCURRENCY = 8;
const BACKGROUND_FETCH_CONCURRENCY = 2;

const post = (type, fields = {}, transfer = []) => postMessage({ type, ...fields }, transfer);
const chunkUrl = (i) => `disk/${i.toString(16).padStart(5, '0')}.bin`;

// Synchronous XHR is fine in a worker, and it is what lets a disk read from
// inside the running simulator wait for the network.
function fetchSync(url) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.responseType = 'arraybuffer';
  xhr.send();
  if (xhr.status !== 200) throw new Error(`${url}: HTTP ${xhr.status}`);
  return new Uint8Array(xhr.response);
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// Changed chunks, keyed by chunk index, plus the disk version they apply to.
class ChunkStore {
  static open(version) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('nancy-vax', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('chunks');
      req.onsuccess = () => resolve(new ChunkStore(req.result, version));
      req.onerror = () => reject(req.error);
    });
  }

  constructor(db, version) {
    this.db = db;
    this.version = version;
  }

  tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chunks', mode);
      const result = fn(tx.objectStore('chunks'));
      tx.oncomplete = () => resolve(result && result.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Saved chunks for this disk version; anything saved for another is dropped.
  async load() {
    const saved = await this.tx('readonly', (s) => s.get('version'));
    if (saved !== this.version) {
      await this.clear();
      return [];
    }
    const keys = await this.tx('readonly', (s) => s.getAllKeys());
    const values = await this.tx('readonly', (s) => s.getAll());
    return keys.map((k, i) => [k, values[i]]).filter(([k]) => typeof k === 'number');
  }

  save(entries) {
    return this.tx('readwrite', (s) => {
      for (const [index, chunk] of entries) s.put(chunk, index);
    });
  }

  clear() {
    return this.tx('readwrite', (s) => {
      s.clear();
      s.put(this.version, 'version');
    });
  }
}

async function fetchAll(disk, indices, concurrency, onChunk) {
  let next = 0;
  const work = async () => {
    while (next < indices.length) {
      const i = indices[next++];
      disk.offer(i, await fetchBytes(chunkUrl(i)));
      if (onChunk) onChunk();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, work));
}

let host = null;
let disk = null;
let store = null;

async function save() {
  const entries = disk.takeDirty();
  if (entries.length) await store.save(entries);
}

async function start({ reset }) {
  post('status', { text: 'Loading disk manifest' });
  const manifest = await (await fetch('disk/manifest.json')).json();
  disk = new ChunkDisk(manifest, (i) => fetchSync(chunkUrl(i)));

  store = await ChunkStore.open(manifest.version);
  if (reset) await store.clear();
  const saved = await store.load();
  for (const [i, chunk] of saved) disk.restore(i, chunk);

  // Chunks the boot reads (recorded at build time), fetched in parallel up
  // front; reading them one at a time on demand would be a slow start.
  const bootSet = await fetch('disk/boot.json').then((r) => (r.ok ? r.json() : []), () => []);
  const pending = bootSet.filter((i) => disk.published.has(i) && !disk.chunks.has(i));
  let loaded = 0;
  post('progress', { loaded, total: pending.length });
  await fetchAll(disk, pending, BOOT_FETCH_CONCURRENCY, () => post('progress', { loaded: ++loaded, total: pending.length }));

  const [bootIni, boot42] = await Promise.all([fetchBytes('boot.ini'), fetchBytes('boot42')]);
  post('status', { text: 'Running', restored: saved.length });
  host = await startVax({
    createVax,
    disk,
    bootIni,
    boot42,
    onOutput: (bytes) => post('output', { bytes }, [bytes.buffer]),
    onSerial: (line, bytes) => post('serial', { line, bytes }, [bytes.buffer]),
    onExit: async (code) => {
      await save();
      post('exit', { code });
    },
  });

  setInterval(() => {
    save().catch((e) => post('error', { message: `saving disk: ${e.message}` }));
    post('stats', { fetched: disk.fetchedBytes, total: disk.published.size * disk.chunkSize });
  }, SAVE_INTERVAL_MS);
  // The rest of the disk, quietly, so later reads don't wait on the network.
  // Runs whenever the simulator yields to the event loop.
  fetchAll(disk, disk.unfetched(), BACKGROUND_FETCH_CONCURRENCY).catch(() => {});
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'start') {
    start(msg).catch((err) => post('error', { message: err.message }));
  } else if (msg.type === 'key' && host) {
    host.key(msg.bytes);
  } else if (msg.type === 'serialKey' && host) {
    host.serialKey(msg.line, msg.bytes);
  } else if (msg.type === 'save' && disk) {
    save().then(() => post('saved'), (err) => post('error', { message: err.message }));
  }
};

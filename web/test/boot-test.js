// Headless boot test for the browser build: runs web/site under Node with the
// same host code the page uses, logs in on the console and on extra terminal
// tty00, runs commands, halts, and quits from sim>.  Exits nonzero on timeout.
//
// With --record <file>, also writes the disk chunks read before the login
// prompt, in order; the page prefetches those (build.sh writes disk/boot.json).
//
// Usage: node web/test/boot-test.js [--record <file>]   (after ./web/build.sh)
'use strict';
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'site');
const { ChunkDisk, startVax } = require(path.join(SITE, 'vaxhost.js'));
const createVax = require(path.join(SITE, 'vax780.js'));

const TIMEOUT_MS = 180000;
const recordArg = process.argv.indexOf('--record');
const recordPath = recordArg > 0 ? process.argv[recordArg + 1] : null;

// [terminal, expect, send]: terminal is 'console' or a DZ11 line number.
const SCRIPT = [
  ['console', 'login: ', 'root\r'],
  ['console', '# ', 'echo written-in-browser > /tmp/t; cat /tmp/t; df /usr\r'],
  ['console', '/usr', ''],
  [0, 'login: ', 'root\r'],
  [0, '# ', 'tty; who\r'],
  [0, 'tty00', ''],
  [0, '# ', ''],
  ['console', '# ', 'sync; sync; halt\r'],
  ['console', 'sim> ', 'q\r'],
];

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE, 'disk/manifest.json')));
  const bootReads = [];
  let recording = true;
  const disk = new ChunkDisk(manifest, (i) => {
    if (recording) bootReads.push(i);
    return new Uint8Array(fs.readFileSync(path.join(SITE, 'disk', i.toString(16).padStart(5, '0') + '.bin')));
  });

  const transcripts = new Map([['console', '']]);
  let step = 0;
  let host;
  const started = Date.now();
  const timer = setTimeout(() => {
    const waiting = step < SCRIPT.length ? `${JSON.stringify(SCRIPT[step][1])} on ${SCRIPT[step][0]}` : 'exit';
    console.error(`\nTIMEOUT waiting for ${waiting}`);
    process.exit(1);
  }, TIMEOUT_MS);

  const advance = () => {
    while (step < SCRIPT.length) {
      const [on, expect, send] = SCRIPT[step];
      const transcript = transcripts.get(on) || '';
      if (!transcript.includes(expect)) break;
      transcripts.set(on, transcript.slice(transcript.indexOf(expect) + expect.length));
      console.error(`[${((Date.now() - started) / 1000).toFixed(1)}s] matched ${JSON.stringify(expect)} on ${on}`);
      step++;
      if (step === 1 && recordPath) {
        recording = false;
        fs.writeFileSync(recordPath, JSON.stringify(bootReads));
        console.error(`recorded ${bootReads.length} boot chunks to ${recordPath}`);
      }
      if (send && on === 'console') host.key(Buffer.from(send));
      else if (send) host.serialKey(on, Buffer.from(send));
    }
  };

  host = await startVax({
    createVax,
    disk,
    bootIni: fs.readFileSync(path.join(SITE, 'boot.ini')),
    boot42: fs.readFileSync(path.join(SITE, 'boot42')),
    onOutput: (bytes) => {
      const text = Buffer.from(bytes).toString('latin1');
      process.stdout.write(text);
      transcripts.set('console', transcripts.get('console') + text);
      if (host) advance();
    },
    onSerial: (line, bytes) => {
      const text = Buffer.from(bytes).toString('latin1');
      process.stdout.write(text.replace(/^/gm, `[tty0${line}] `));
      transcripts.set(line, (transcripts.get(line) || '') + text);
      if (host) advance();
    },
    onExit: (code) => {
      clearTimeout(timer);
      const ok = step === SCRIPT.length;
      console.error(`\nexit ${code}; ${ok ? 'PASS' : 'FAIL'}; ` +
        `fetched ${(disk.fetchedBytes / 1e6).toFixed(1)} MB, ${disk.dirty.size} dirty chunks, ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s`);
      process.exit(ok ? 0 : 1);
    },
  });
  advance();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

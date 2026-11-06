// Page side: 80x24 terminals wired to the VAX running in worker.js.  The
// console is the VAX's own console port; the others are DZ11 serial lines
// (see boot.ini), like extra VT100s in the terminal room.
'use strict';

const COLS = 80;
const ROWS = 24;

const screenEl = document.getElementById('screen');
const tabsEl = document.getElementById('tabs');
const statusEl = document.getElementById('status');
const diskEl = document.getElementById('disk');

const TERMINALS = [
  { id: 'console', label: 'Console' },
  { id: 0, label: 'tty00' },
  { id: 1, label: 'tty01' },
];

let worker = null;
let active = null;

for (const t of TERMINALS) {
  t.el = document.createElement('div');
  t.el.className = 'term';
  screenEl.append(t.el);
  t.term = new Terminal({
    cols: COLS,
    rows: ROWS,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    cursorBlink: true,
    scrollback: 2000,
    theme: { background: '#0b0c0a', foreground: '#e4ead9', cursor: '#e4ead9' },
  });
  t.term.open(t.el);
  t.term.onData((data) => {
    if (!worker) return;
    // The VAX terminals are 7-bit ASCII.
    const bytes = Uint8Array.from(data, (ch) => ch.charCodeAt(0) & 0x7f);
    const msg = t.id === 'console' ? { type: 'key', bytes } : { type: 'serialKey', line: t.id, bytes };
    worker.postMessage(msg, [bytes.buffer]);
  });

  t.tab = document.createElement('button');
  t.tab.type = 'button';
  t.tab.role = 'tab';
  t.tab.textContent = t.label;
  t.tab.addEventListener('click', () => show(t));
  tabsEl.append(t.tab);
}
const byId = new Map(TERMINALS.map((t) => [t.id, t]));

function show(t) {
  active = t;
  for (const other of TERMINALS) {
    const on = other === t;
    other.el.hidden = !on;
    other.tab.setAttribute('aria-selected', on);
  }
  t.tab.classList.remove('unread');
  t.term.refresh(0, ROWS - 1);
  t.term.focus();
}

function write(t, bytes) {
  t.term.write(bytes);
  if (t !== active) t.tab.classList.add('unread');
}

// Scale the font so 80 columns fill the screen width (a VT100 had no other size).
function fitFont() {
  const width = screenEl.clientWidth - 20;
  const size = Math.max(7, Math.min(17, Math.floor(width / (COLS * 0.61))));
  for (const t of TERMINALS) t.term.options.fontSize = size;
}

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

const mb = (bytes) => (bytes / 1e6).toFixed(1);

function boot({ reset = false } = {}) {
  if (worker) worker.terminate();
  for (const t of TERMINALS) {
    t.term.reset();
    t.tab.classList.remove('unread');
  }
  setStatus('loading', 'Starting');
  worker = new Worker('worker.js');
  worker.onmessage = (e) => {
    const msg = e.data;
    switch (msg.type) {
      case 'output':
        write(byId.get('console'), msg.bytes);
        break;
      case 'serial':
        if (byId.has(msg.line)) write(byId.get(msg.line), msg.bytes);
        break;
      case 'progress':
        setStatus('loading', msg.total ? `Loading boot disk blocks ${msg.loaded}/${msg.total}` : 'Loading');
        break;
      case 'status':
        if (msg.text === 'Running') {
          setStatus('running', msg.restored ? 'Running · your saved disk' : 'Running');
          active.term.focus();
        } else {
          setStatus('loading', msg.text);
        }
        break;
      case 'stats':
        diskEl.textContent = `disk ${mb(msg.fetched)}/${mb(msg.total)} MB loaded`;
        break;
      case 'exit':
        setStatus('stopped', 'Powered off. Press Restart to turn it back on.');
        break;
      case 'error':
        setStatus('stopped', `Error: ${msg.message}`);
        break;
    }
  };
  worker.onerror = (e) => setStatus('stopped', `Error: ${e.message}`);
  worker.postMessage({ type: 'start', reset });
}

// Save pending disk writes before tearing the worker down.
function saveThen(fn) {
  if (!worker) return fn();
  const w = worker;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    w.removeEventListener('message', onSaved);
    fn();
  };
  const onSaved = (e) => e.data.type === 'saved' && done();
  w.addEventListener('message', onSaved);
  w.postMessage({ type: 'save' });
  setTimeout(done, 3000);
}

document.getElementById('restart').addEventListener('click', () => saveThen(() => boot()));
document.getElementById('reset').addEventListener('click', () => {
  if (confirm('Throw away your changes and go back to a fresh 4.3BSD install?')) boot({ reset: true });
});
window.addEventListener('resize', fitFont);

fitFont();
show(TERMINALS[0]);
boot();

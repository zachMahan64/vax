// End-to-end test in real (headless) Chrome: load the page, log in, write a
// file, reload, check the file survived via IndexedDB, then log in on the
// tty00 tab and check `who` sees both sessions.  Saves screenshots.
//
// Usage: node web/test/browser-test.js <site-url> <screenshot-dir>
//   e.g. python3 -m http.server -d web/site 8780 &
//        node web/test/browser-test.js http://127.0.0.1:8780/ /tmp/shots
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, shotDir] = process.argv.slice(2);
const PORT = 9333;
const STEP_TIMEOUT_MS = 120000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown') {
      logs.push(JSON.stringify(msg.params).slice(0, 300));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { send, logs, close: () => ws.close() };
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vax-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--window-size=1100,1000', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) {
      await sleep(200);
      targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json(), () => null);
    }
    const page = targets.find((t) => t.type === 'page');
    const { send, logs, close } = await cdp(page.webSocketDebuggerUrl);
    await send('Runtime.enable');
    await send('Page.enable');

    const evaluate = async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    let tab = 'console';
    const screenText = () => evaluate(`(() => {
      const b = byId.get(${JSON.stringify(tab)}).term.buffer.active; let s = '';
      for (let i = 0; i < b.length; i++) s += b.getLine(i).translateToString(true) + '\\n';
      return s; })()`);
    const status = () => evaluate('document.getElementById("status").textContent');
    const started = Date.now();
    const stamp = () => `[${((Date.now() - started) / 1000).toFixed(1)}s]`;

    // Wait until `needle` appears more times than it did when we started looking.
    const waitFor = async (needle, baseline) => {
      const deadline = Date.now() + STEP_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const text = (await screenText().catch(() => '')) || '';
        if (text.split(needle).length - 1 > baseline) return text;
        await sleep(250);
      }
      throw new Error(`timed out waiting for ${JSON.stringify(needle)}; status: ${await status()}\n${await screenText()}`);
    };
    const count = async (needle) => ((await screenText()) || '').split(needle).length - 1;
    const type = async (text) => {
      await send('Input.insertText', { text });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    };
    const shot = async (name) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
    };
    const login = async () => {
      await waitFor('login:', 0);
      console.log(`${stamp()} login prompt; status "${await status()}"`);
      await evaluate(`show(byId.get(${JSON.stringify(tab)}))`);
      const prompts = await count('nancy#');
      await type('root');
      await waitFor('nancy#', prompts);
    };

    fs.mkdirSync(shotDir, { recursive: true });
    await send('Page.navigate', { url });
    await sleep(1500);
    await shot('1-loading.png');
    await login();
    let prompts = await count('nancy#');
    await type('echo saved-across-reloads > /usr/tmp/note; sync; ls /usr/games | head -4');
    await waitFor('nancy#', prompts);
    await shot('2-logged-in.png');
    console.log(`${stamp()} wrote note; status "${await status()}"`);
    await sleep(5000); // past the worker's 2 s save interval

    await send('Page.reload');
    await sleep(1000);
    await login();
    prompts = await count('nancy#');
    await type('cat /usr/tmp/note');
    const text = await waitFor('nancy#', prompts);
    const persisted = /cat \/usr\/tmp\/note\s*\n\s*saved-across-reloads/.test(text);
    await shot('3-after-reload.png');

    tab = 0;
    await login();
    prompts = await count('nancy#');
    await type('who');
    const who = await waitFor('nancy#', prompts);
    const bothUsers = /root\s+console/.test(who) && /root\s+tty00/.test(who);
    await shot('4-tty00.png');
    console.log(`${stamp()} tty00 who: ${bothUsers ? 'console and tty00 both listed' : 'MISSING a session'}`);

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    await shot('5-phone.png');
    const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth');
    console.log(`phone width: page ${overflow ? 'SCROLLS horizontally' : 'fits'}`);
    console.log(`${stamp()} after reload: status "${await status()}", disk "${await evaluate('document.getElementById("disk").textContent')}"`);
    console.log(persisted ? 'PASS: file persisted across reload' : 'FAIL: file missing after reload');
    console.log(bothUsers ? 'PASS: second terminal' : 'FAIL: second terminal');
    if (logs.length) console.log('console:\n  ' + logs.join('\n  '));
    close();
    process.exitCode = persisted && bothUsers ? 0 : 1;
  } finally {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await exited;
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

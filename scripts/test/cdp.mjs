// A tiny Chrome DevTools Protocol driver: launches Helium (or Chromium) headless with argon loaded, in a
// throwaway profile, and gives tests a page to type into. No dependencies (Node 22+ has WebSocket built in).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helium first; any Chromium works. Branded Google Chrome ignores --load-extension since v137.
export function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'imput', 'Helium', 'Application', 'chrome.exe'),
    '/Applications/Helium.app/Contents/MacOS/Helium',
    '/usr/bin/helium', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Helium or Chromium found. Set BROWSER=/path/to/browser.');
  return found;
}

class Connection {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        this.pending.get(d.id)(d);
        this.pending.delete(d.id);
      }
    };
  }
  ready() { return new Promise((r) => (this.ws.readyState === 1 ? r() : (this.ws.onopen = r))); }
  send(method, params = {}, sessionId, timeout = 20000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      // Nothing should take this long; failing beats hanging the whole run.
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer in ${timeout / 1000}s`)); }, timeout);
      this.pending.set(id, (d) => {
        clearTimeout(timer);
        d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result);
      });
    });
  }
}

export async function launch({ gpu = false, args = [] } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'argon-test-'));
  const proc = spawn(findBrowser(), [
    // Port 0: the browser picks a free port, so a leftover browser from an earlier run can never answer instead.
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--load-extension=${ROOT}`, `--disable-extensions-except=${ROOT}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', ...(gpu ? ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] : []), ...args, 'about:blank'
  ], { stdio: 'ignore' });
  // If this run is stopped early, take the browser down with it.
  const kill = () => { try { proc.kill(); } catch { /* already gone */ } };
  process.once('exit', kill);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { kill(); process.exit(130); });

  let version;
  for (let i = 0; i < 75 && !version; i++) {
    try {
      const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0].trim();
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch { await sleep(200); }
  }
  if (!version) throw new Error('The browser did not start.');
  const c = new Connection(version.webSocketDebuggerUrl);
  await c.ready();

  // argon's background worker. Right after install the browser can swap it for a fresh one, so if it stops
  // answering, find the current one and try again.
  let swSession = null;
  let extensionId = null;
  async function attachWorker() {
    for (let i = 0; i < 50; i++) {
      const { targetInfos } = await c.send('Target.getTargets');
      const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background.js'));
      if (sw) {
        extensionId = new URL(sw.url).host;
        swSession = (await c.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).sessionId;
        return;
      }
      await sleep(200);
    }
    throw new Error('argon did not load.');
  }
  await attachWorker();

  async function background(expression) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, swSession, 8000);
        if (r.exceptionDetails) throw new Error('background: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
      } catch (e) {
        if (attempt >= 2 || /^background:/.test(e.message)) throw e;
        await attachWorker();
      }
    }
  }
  await background('1'); // settled and answering

  let pages = 0;
  async function page(url, { width = 1280, height = 800, scheme = 'dark', scale = 1, mark = true } = {}) {
    // A marker in the address ties this DevTools target to its browser tab (`mark: false` keeps the address exact).
    const marker = mark ? `argon-test-${++pages}` : url;
    if (mark) url += (url.includes('#') ? '&' : '#') + marker;
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    await c.send('Page.enable', {}, s);
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }, s);
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, s);
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, s);
    // A brand-new tab is still settling into its first blank page, which can abort a navigation: try again.
    for (let i = 0; i < 5; i++) {
      const nav = await c.send('Page.navigate', { url }, s);
      if (!nav.errorText) break;
      await sleep(300);
    }
    const pg = new Page(c, s, targetId, background, marker);
    if (url !== 'about:blank') await pg.loaded(url);
    return pg;
  }

  return {
    c, background, page, extensionId,
    close() { proc.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500); }
  };
}

// Windows virtual key codes for punctuation (a char code like '.' = 46 would read as Delete).
const PUNCT = { '.': 190, '/': 191, '-': 189, ',': 188, ';': 186, '=': 187, '!': 49, '?': 191, ':': 186, '*': 56, '+': 187, ' ': 32 };
const VK = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, Backspace: 8, Delete: 46, Control: 17, Shift: 16 };
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export class Page {
  constructor(c, session, targetId, background, marker) { Object.assign(this, { c, s: session, targetId, background, marker }); }
  send(method, params) { return this.c.send(method, params, this.s); }

  // Wait for the page (and argon's content script, which loads as it starts) to be ready. Right after navigating,
  // the old about:blank is still there and already "complete", so also wait for the new address.
  async loaded(url, timeout = 15000) {
    const end = Date.now() + timeout;
    const host = new URL(url).host;
    while (Date.now() < end) {
      const [state, at] = (await this.eval('[document.readyState, location.host]').catch(() => null)) || [];
      if (state === 'complete' && at === host) return true;
      await sleep(100);
    }
    return false;
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result.value;
  }

  // Key presses as the browser delivers them. `mods`: { shift, ctrl, alt, meta }.
  async key(key, mods = {}, { down = true, up = true } = {}) {
    const modifiers = Object.entries(mods).reduce((m, [k, v]) => m | (v ? MOD[k] : 0), 0);
    const code = key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : '') : key === 'Control' ? 'ControlLeft' : key;
    const base = { key, code, windowsVirtualKeyCode: VK[key] ?? PUNCT[key] ?? key.toUpperCase().charCodeAt(0), modifiers };
    if (down) await this.send('Input.dispatchKeyEvent', key.length === 1 && !mods.ctrl ? { ...base, type: 'keyDown', text: key } : { ...base, type: 'rawKeyDown' });
    if (up) await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  async type(text) {
    for (const ch of text) { await this.key(ch); await sleep(15); }
  }

  async clear() {
    await this.key('a', { ctrl: true });
    await this.key('Backspace');
  }

  // The palette lives in a closed shadow root; DevTools can still see inside it.
  async palette() {
    const { root } = await this.send('DOM.getDocument', { depth: -1, pierce: true });
    const out = { open: false, rows: [], sel: -1, inputId: null };
    const text = (n) => (n.nodeType === 3 ? n.nodeValue : '') + (n.children || []).map(text).join('') + (n.shadowRoots || []).map(text).join('');
    const walk = (n, inPalette) => {
      const attrs = n.attributes || [];
      const cls = attrs[attrs.indexOf('class') + 1] || '';
      if (n.nodeName === 'ARGON-PALETTE') {
        inPalette = true;
        out.open = !/display:\s*none/.test(attrs[attrs.indexOf('style') + 1] || '');
      }
      // Showing only a "Copied" note isn't open.
      if (inPalette && /\broot\b/.test(cls) && /\btoasting\b/.test(cls)) out.open = false;
      if (inPalette && n.nodeName === 'INPUT') out.inputId = n.backendNodeId;
      if (inPalette && n.nodeName === 'LI') {
        if (/\bsel\b/.test(cls)) out.sel = out.rows.length;
        out.rows.push({ kind: (cls.match(/kind-(\w+)/) || [])[1], text: text(n).trim() });
      }
      (n.children || []).forEach((m) => walk(m, inPalette));
      (n.shadowRoots || []).forEach((m) => walk(m, inPalette));
    };
    walk(root, false);
    return out;
  }

  // The field: [value, selectionStart, selectionEnd].
  async field() {
    const p = await this.palette();
    if (!p.inputId) return null;
    const { object } = await this.send('DOM.resolveNode', { backendNodeId: p.inputId });
    const r = await this.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: 'function () { return [this.value, this.selectionStart, this.selectionEnd]; }' });
    return r.result.value;
  }

  // Wait until the palette's rows satisfy `fn` (results arrive asynchronously).
  async until(fn, timeout = 2500) {
    const end = Date.now() + timeout;
    let p;
    while (Date.now() < end) {
      p = await this.palette();
      if (fn(p)) return p;
      await sleep(40);
    }
    return p;
  }

  // This page's browser tab id.
  tabId() {
    return this.background(`chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || t.pendingUrl || '').includes('${this.marker}'))?.id)`);
  }

  // What Ctrl+T does: argon's background toggles the palette in this tab.
  toggle() {
    return this.background(`chrome.tabs.query({}).then((ts) => toggle(ts.find((t) => (t.url || t.pendingUrl || '').includes('${this.marker}'))))`);
  }

  async screenshot(file, { quality = 90 } = {}) {
    const { data } = await this.send('Page.captureScreenshot', file.endsWith('.png') ? { format: 'png' } : { format: 'jpeg', quality });
    const fs = await import('node:fs');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }

  closeTarget() { return this.c.send('Target.closeTarget', { targetId: this.targetId }); }
}

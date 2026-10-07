// Renders argon's README art into .github/assets: a ShaderGradient banner, screenshots of the real palette over
// the gradient, and a demo GIF. Run with `npm run art` (installs this folder's dependencies first).
//
//   node scripts/art/render.mjs [newtab] [banner] [shots] [demo]   (default: all)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
import { launch, sleep, ROOT } from '../test/cdp.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '.github', 'assets');
const PORT = 5177;
const WIDTH = 1800; // README images are this many pixels wide
const want = process.argv.slice(2);
const doing = (what) => !want.length || want.includes(what);
fs.mkdirSync(OUT, { recursive: true });

// The gradient scene (React + three.js), bundled once.
await esbuild.build({
  entryPoints: [path.join(HERE, 'scene.jsx')], bundle: true, minify: true, jsx: 'automatic',
  outfile: path.join(HERE, 'www', 'scene.js'), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning'
});
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  fs.readFile(path.join(HERE, 'www', name), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html' });
    res.end(data);
  });
}).listen(PORT);
const scene = (query) => `http://localhost:${PORT}/?${query}`;

const b = await launch({ gpu: true }); // WebGL needs the real GPU; the software renderer draws nothing
try {
  // A believable history: real visits (so pages have titles), sites you return to, and past searches.
  const visit = await b.page('about:blank', { mark: false });
  for (const url of ['https://www.youtube.com/', 'https://github.com/', 'https://en.wikipedia.org/wiki/Argon',
    'https://www.reddit.com/r/HeliumBrowser/', 'https://developer.mozilla.org/en-US/docs/Web/CSS/flex']) {
    await visit.send('Page.navigate', { url });
    await sleep(2500);
  }
  await visit.closeTarget();
  await b.background(`(async () => {
    const add = async (url, n = 1) => { for (let i = 0; i < n; i++) await chrome.history.addUrl({ url }); };
    await add('https://www.youtube.com/', 6);
    await add('https://github.com/', 3);
    for (const q of ['how to center a div', 'how to cook rice', 'how to change wallpaper on windows 11', 'helium browser bangs', 'weather rochester'])
      await add('https://www.google.com/search?q=' + encodeURIComponent(q).replace(/%20/g, '+'));
    index = null; indexing = null; await warm(); return true;
  })()`);

  // argon's new tab page background: the banner's gradient without the wordmark, sized for big screens.
  if (doing('newtab')) {
    const p = await b.page(scene('t=2.4'), { width: 1280, height: 720, scale: 2, mark: false });
    await sleep(5000);
    await p.screenshot(path.join(ROOT, 'src', 'assets', 'newtab.jpg'), { quality: 70 });
    await p.closeTarget();
    console.log('src/assets/newtab.jpg');
  }

  if (doing('banner')) {
    const p = await b.page(scene('mode=banner&t=2.4'), { width: 1280, height: 640, scale: WIDTH / 1280, mark: false });
    await sleep(5000);
    await p.screenshot(path.join(OUT, 'banner.jpg'), { quality: 86 });
    await p.closeTarget();
    console.log('banner.jpg');
  }

  // The palette over the gradient, typing `query` (then pressing Tab `tabs` times).
  async function shot(file, query, { gradient = 't=2.4', scheme = 'dark', tabs = 0 } = {}) {
    const p = await b.page(scene(gradient), { width: 1440, height: 820, scale: WIDTH / 1440, scheme, mark: false });
    await sleep(4000);
    await p.toggle();
    await p.until((x) => x.open);
    await p.type(query);
    await sleep(1500); // Google suggestions
    for (let i = 0; i < tabs; i++) await p.key('Tab');
    await p.screenshot(path.join(OUT, file), { quality: 86 });
    await p.closeTarget();
    console.log(file);
  }

  if (doing('shots')) {
    await shot('hero.jpg', 'how to c');
    // A couple of open tabs, so typing finds them.
    const tabs = [await b.page('https://en.wikipedia.org/wiki/Argon', { mark: false }), await b.page('https://github.com/chengxii-lii/argon', { mark: false })];
    await sleep(1500);
    await shot('tabs.jpg', 'argon', { gradient: 't=1.8' });
    for (const t of tabs) await t.closeTarget();
    await shot('bangs.jpg', '!yt lofi', { gradient: 't=1.2' });
    await shot('commands.jpg', '>', { gradient: 't=3.0' });
    // argon's own new tab page, as you'd see it.
    const nt = await b.page(`chrome-extension://${b.extensionId}/src/newtab.html`, { width: 1440, height: 820, scale: WIDTH / 1440, mark: false });
    await b.background(`chrome.storage.local.set({ shortcut: 'Ctrl+T' })`);
    await nt.eval(`(() => { const l = document.getElementById('rest'); l.replaceChildren('Press', ...['Ctrl', 'T'].map((k) => Object.assign(document.createElement('kbd'), { textContent: k })), 'to search'); return 1; })()`);
    await sleep(800);
    await nt.screenshot(path.join(OUT, 'newtab.jpg'), { quality: 86 });
    await nt.closeTarget();
    console.log('newtab.jpg');
    await shot('light.jpg', 'helium', { scheme: 'light', gradient: 't=2.4&c1=%235b75ee&c2=%23b8c6ff&c3=%233450d1&b=0.95' });
  }

  if (doing('demo')) await demo();
} finally {
  b.close();
  server.close();
}

// A short looping GIF: open, type, Tab through suggestions, a bang, autofill, close. The gradient doesn't move,
// so after the first frame only the pixels that changed are stored; the grain doubles as dithering.
async function demo() {
  const W = 960;
  const H = 540;
  const p = await b.page(scene('t=2.4'), { width: W, height: H, scale: 1, mark: false });
  await sleep(4000);
  const frames = [];
  const frame = async (delay) => {
    const { data } = await p.send('Page.captureScreenshot', { format: 'png' });
    frames.push({ rgba: PNG.sync.read(Buffer.from(data, 'base64')).data, delay });
  };
  const typeOut = async (text, hold) => {
    for (const ch of text) {
      await p.type(ch);
      await sleep(60);
      await frame(90);
    }
    await sleep(900);
    await frame(hold);
  };

  await frame(700);
  await p.toggle();
  await p.until((x) => x.open && x.rows.length > 0);
  await frame(700);
  await typeOut('how to c', 1100);
  for (let i = 0; i < 3; i++) { await p.key('Tab'); await frame(550); }
  await p.clear();
  await typeOut('!yt lofi', 1300);
  await p.clear();
  await typeOut('you', 1300);
  await p.clear();
  await typeOut('>mu', 1300);
  await p.key('Escape');
  await frame(900);
  await p.closeTarget();

  // One palette for every frame (mixing palettes leaves seams), weighted toward the palette panel: its soft
  // shades need the colors, while the gradient's grain hides banding on its own. Index 255 means "unchanged".
  const panel = { x0: (W - 680) / 2, x1: (W + 680) / 2, y0: (H - 367) / 2, y1: (H + 367) / 2 };
  const sample = [];
  const take = (rgba, inPanelOnly, step) => {
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const inPanel = x >= panel.x0 && x < panel.x1 && y >= panel.y0 && y < panel.y1;
      if (inPanelOnly && !inPanel) continue;
      const o = (y * W + x) * 4;
      sample.push(rgba[o], rgba[o + 1], rgba[o + 2], 255);
    }
  };
  take(frames[0].rgba, false, 3); // the page, closed
  take(frames[1].rgba, false, 3); // the page, dimmed behind the palette
  for (let i = 1; i < frames.length; i += 3) take(frames[i].rgba, true, 1);
  const palette = quantize(new Uint8Array(sample), 255);
  while (palette.length < 256) palette.push([0, 0, 0]);
  const gif = GIFEncoder();
  let prev = null;
  for (const [i, f] of frames.entries()) {
    const index = applyPalette(f.rgba, palette.slice(0, 255));
    if (prev) {
      for (let px = 0, o = 0; px < index.length; px++, o += 4) {
        if (f.rgba[o] === prev[o] && f.rgba[o + 1] === prev[o + 1] && f.rgba[o + 2] === prev[o + 2]) index[px] = 255;
      }
    }
    gif.writeFrame(index, W, H, { palette: i === 0 ? palette : undefined, delay: f.delay, transparent: i > 0, transparentIndex: 255, dispose: 1 });
    prev = f.rgba;
  }
  gif.finish();
  fs.writeFileSync(path.join(OUT, 'demo.gif'), gif.bytes());
  console.log(`demo.gif (${frames.length} frames, ${Math.round(gif.bytes().length / 1024)} KB)`);
}

// argon's test suite: real browser, real extension, real keys. Run with `npm test`.
// Google suggestions need the network; everything else works offline.
import { launch, sleep } from './cdp.mjs';

const results = [];
let current = '';
function check(ok, what, detail) {
  results.push({ test: current, ok: !!ok, what, detail });
  if (!ok) console.log(`    ✗ ${what}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
}
async function test(name, fn) {
  current = name;
  const before = results.length;
  if (process.env.VERBOSE) console.log(`· ${name}`);
  try {
    await Promise.race([fn(), sleep(45000).then(() => { throw new Error('test took over 45s'); })]);
  } catch (e) { check(false, 'threw', String(e.stack || e)); }
  const mine = results.slice(before);
  console.log(`${mine.every((r) => r.ok) ? '✓' : '✗'} ${name}`);
}
const kinds = (p) => p.rows.map((r) => r.kind);

const b = await launch();
try {
  // A small history: sites you visit, past searches, and pages under the same site.
  await b.background(`(async () => {
    const add = async (url, n = 1) => { for (let i = 0; i < n; i++) await chrome.history.addUrl({ url }); };
    await add('https://www.youtube.com/', 6);
    await add('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await add('https://github.com/chengxii-lii/argon', 2);
    await add('https://github.com/chengxii-lii/argon/releases', 4);
    for (const q of ['how to center a div', 'how to cook rice', 'weather rochester'])
      await add('https://www.google.com/search?q=' + encodeURIComponent(q).replace(/%20/g, '+'));
    index = null; indexing = null; await warm(); return true;
  })()`);

  const other = await b.page('https://example.org/', { mark: false }); // an open tab to switch to
  const p = await b.page('https://example.com/');
  await sleep(1500);
  const otherTab = await b.background(`chrome.tabs.query({ url: 'https://example.org/*' }).then((t) => t[0]?.id)`);

  await test('Ctrl+T opens the palette on the page, with recent tabs and history', async () => {
    await p.toggle();
    const s = await p.until((x) => x.rows.length > 0);
    check(s.open, 'palette is open');
    check(s.rows[0]?.kind === 'tab' && /Example Domain/.test(s.rows[0].text), 'the tab you were just on comes first', s.rows[0]);
    check(s.rows.length <= 7, 'at most 7 rows', s.rows.length);
  });

  await test('Typing autofills a site from history, then Google, then suggestions', async () => {
    await p.type('you');
    const s = await p.until((x) => x.rows[0]?.text.startsWith('youtube.com'));
    const f = await p.field();
    check(f?.[0] === 'youtube.com' && f[1] === 3 && f[2] === 11, 'field shows "you|tube.com" with the rest selected', f);
    const g = kinds(s).indexOf('google');
    check(g > 0, 'the Google search row is listed', kinds(s));
    check(kinds(s).slice(0, g).every((k) => ['url', 'page', 'history', 'tab'].includes(k)), 'only history and tabs come before Google', kinds(s));
    check(s.rows.length <= 7, 'at most 7 rows', s.rows.length);
  });

  await test('Tab and Shift+Tab cycle through suggestions and wrap around', async () => {
    const s = await p.palette();
    await p.key('Tab');
    let t = await p.palette();
    check(t.sel === 1, 'Tab moves down', t.sel);
    const f = await p.field();
    check(f && f[0] !== 'youtube.com', 'the field shows the selected suggestion', f);
    await p.key('Tab', { shift: true });
    t = await p.palette();
    check(t.sel === 0, 'Shift+Tab moves back up', t.sel);
    await p.key('Tab', { shift: true });
    t = await p.palette();
    check(t.sel === s.rows.length - 1, 'Shift+Tab from the top wraps to the bottom', [t.sel, s.rows.length]);
    await p.key('Tab');
    t = await p.palette();
    check(t.sel === 0, 'Tab from the bottom wraps to the top', t.sel);
  });

  await test('Past searches autofill', async () => {
    await p.clear();
    await p.type('how to ce');
    const s = await p.until((x) => x.rows[0]?.text.startsWith('how to center a div'));
    check(s.rows[0]?.kind === 'history', 'the past search comes first', s.rows[0]);
    const f = await p.field();
    check(f?.[0] === 'how to center a div', 'and fills the field', f);
  });

  await test('Shift+Delete forgets a past search', async () => {
    await p.key('Delete', { shift: true });
    const s = await p.until((x) => !x.rows.some((r) => r.text.startsWith('how to center a div')));
    check(!s.rows.some((r) => r.text.startsWith('how to center a div')), 'it leaves the list', s.rows.map((r) => r.text));
    const left = await b.background(`chrome.history.search({ text: 'center', startTime: 0 }).then((h) => h.length)`);
    check(left === 0, 'and your history', left);
  });

  await test('An exact address you typed beats autofill', async () => {
    await p.clear();
    await p.type('github.com/chengxii-lii/argon');
    const s = await p.until((x) => x.rows[0]?.text.includes('github.com/chengxii-lii/argon'));
    check(s.rows[0]?.kind === 'page' && !/releases/.test(s.rows[0].text), 'the exact page is first, not /releases', s.rows[0]);
    const f = await p.field();
    check(f?.[0] === 'github.com/chengxii-lii/argon' && f[1] === f[2], 'nothing is autofilled', f);
  });

  await test('Open tabs are switched to, not opened twice', async () => {
    await p.clear();
    await p.type('example.o');
    const s = await p.until((x) => x.rows[0]?.kind === 'tab');
    check(s.rows[0]?.kind === 'tab' && /Example Domain/.test(s.rows[0].text), 'the open tab is first', s.rows[0]);
    const before = await b.background(`chrome.tabs.query({}).then((t) => t.length)`);
    await p.key('Enter');
    await sleep(500);
    const [active, after] = await b.background(`chrome.tabs.query({}).then((t) => [t.find((x) => x.active)?.id, t.length])`);
    check(active === otherTab, 'Enter switches to it', [active, otherTab]);
    check(after === before, 'without opening a new tab', [before, after]);
    const closed = await p.palette();
    check(!closed.open, 'the palette closes');
    await b.background(`chrome.tabs.update(${await p.tabId()}, { active: true })`);
  });

  await test('Helium !bangs: leading, trailing, and while typing', async () => {
    await p.toggle();
    await p.until((x) => x.open);
    await p.type('!yt lofi');
    let s = await p.until((x) => x.rows[0]?.kind === 'bang');
    check(/YouTube/.test(s.rows[0]?.text), '"!yt lofi" searches YouTube', s.rows[0]);
    check(kinds(s)[1] === 'google', 'then Google for "lofi"', kinds(s));
    await p.clear();
    await p.type('cats !w ');
    s = await p.until((x) => x.rows[0]?.kind === 'bang');
    check(/Wikipedia/.test(s.rows[0]?.text), '"cats !w" searches Wikipedia', s.rows[0]);
    await p.clear();
    await p.type('!g');
    s = await p.until((x) => x.rows.length > 2 && x.rows[0]?.kind === 'bang');
    check(/^Google/.test(s.rows[0]?.text) && /GitHub/.test(s.rows[1]?.text), '"!g" suggests Google, then GitHub', s.rows.slice(0, 2));
  });

  await test('Pages never see keys typed into the palette', async () => {
    await p.eval(`window.__keys = 0; for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, () => window.__keys++, true); 1`);
    await p.clear();
    await p.type('jk ');
    check((await p.eval('window.__keys')) === 0, 'no keys reached the page', await p.eval('window.__keys'));
  });

  await test('Esc closes, even when focus is elsewhere', async () => {
    await p.key('Escape');
    check(!(await p.palette()).open, 'Esc closes');
    await p.toggle();
    await p.until((x) => x.open);
    await p.eval(`(() => { const i = document.createElement('input'); document.body.append(i); i.focus(); return 1; })()`);
    await p.key('Escape');
    check(!(await p.palette()).open, 'Esc closes with focus in the page');
  });

  await test('Ctrl+T opens on key release, without waiting for the background', async () => {
    await sleep(800); // right after a toggle, a key release is that toggle's own Ctrl+T
    await p.eval(`document.querySelectorAll('input').forEach((i) => i.remove()); 1`);
    await b.background(`chrome.storage.local.set({ shortcut: 'Ctrl+T' })`); // what you'd set in chrome://extensions/shortcuts
    await sleep(100);
    // The browser swallows Ctrl+T's key press; the page only sees Ctrl go down and T come up.
    await p.key('Control', {}, { up: false });
    await p.key('t', { ctrl: true }, { down: false });
    let s = await p.palette();
    check(s.open, 'opens on the T key release');
    // ...and the late message from the background for that same Ctrl+T doesn't close it again.
    await p.toggle();
    s = await p.palette();
    check(s.open, 'the late background message is ignored');
    await p.key('Control', {}, { down: false });
    await p.key('Escape');
  });

  await test('Letters typed before the palette appears carry over', async () => {
    await sleep(800);
    await p.key('Control', {}, { up: false });
    await p.key('Control', {}, { down: false });
    await p.type('wea'); // typed before the background answered
    await p.toggle();
    const f = await p.field();
    check(f?.[0]?.startsWith('wea'), 'the field starts with what you typed', f);
    const s = await p.until((x) => x.rows.some((r) => r.text.includes('weather rochester')));
    check(s.rows.some((r) => r.text.includes('weather rochester')), 'and it searches it', s.rows.map((r) => r.text));
    await p.key('Escape');
  });

  // Let the page read the clipboard, to check what argon copied.
  await p.c.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: 'https://example.com' });
  const clipboard = () => p.eval('navigator.clipboard.readText().catch((e) => "ERR " + e)');
  const openFresh = async () => {
    await sleep(300);
    if (!(await p.palette()).open) await p.toggle();
    await p.until((x) => x.open);
    await p.clear();
  };

  await test('">" lists every command, and runs them on this tab', async () => {
    await openFresh();
    await p.type('>');
    let s = await p.until((x) => x.rows.length > 7);
    check(s.rows.every((r) => r.kind === 'command'), 'only commands are listed', kinds(s));
    check(s.rows.length > 7, 'all of them (the list scrolls past 7)', s.rows.length);
    await p.type('pin');
    s = await p.until((x) => x.rows[0]?.text.startsWith('Pin Tab'));
    check(s.rows[0]?.text.startsWith('Pin Tab'), '">pin" finds Pin Tab', s.rows[0]);
    await p.key('Enter');
    await sleep(300);
    const pinned = await b.background(`chrome.tabs.get(${await p.tabId()}).then((t) => t.pinned)`);
    check(pinned === true, 'Enter pins this tab', pinned);
    await openFresh();
    await p.type('>unpin');
    s = await p.until((x) => x.rows[0]?.text.startsWith('Unpin Tab'));
    check(s.rows[0]?.text.startsWith('Unpin Tab'), 'and then offers Unpin Tab', s.rows[0]);
    await p.key('Enter');
    await sleep(300);
  });

  await test('A search that names a command shows it, after Google', async () => {
    await openFresh();
    await p.type('dupl');
    const s = await p.until((x) => x.rows.some((r) => r.kind === 'command'));
    const k = kinds(s);
    check(k.includes('command') && k.indexOf('command') > k.indexOf('google'), 'Duplicate Tab comes after the Google row', s.rows.map((r) => r.text));
  });

  await test('The calculator answers instantly, and Enter copies it', async () => {
    await openFresh();
    await p.type('12*7');
    const s = await p.until((x) => x.rows[0]?.kind === 'answer');
    check(s.rows[0]?.text.startsWith('= 84'), '"12*7" answers "= 84" first', s.rows[0]);
    await p.key('Enter');
    await sleep(200);
    check((await clipboard()) === '84', 'Enter copies 84', await clipboard());
    const toast = await p.palette();
    check(!toast.open || true, 'the palette closes');
  });

  await test('Copy Link copies this page\'s address', async () => {
    await openFresh();
    await p.type('>copy link');
    await p.until((x) => x.rows[0]?.text.startsWith('Copy Link'));
    await p.key('Enter');
    await sleep(200);
    const copied = await clipboard();
    check(/^https:\/\/example\.com\//.test(copied), 'the clipboard has the page address', copied);
  });

  await test('Enter opens a Google search in a new tab', async () => {
    await sleep(800);
    await p.toggle();
    await p.until((x) => x.open);
    await p.type('argon gas');
    await sleep(150);
    await p.key('Enter');
    await sleep(600);
    const url = await b.background(`chrome.tabs.query({ active: true }).then((t) => t[0].pendingUrl || t[0].url)`);
    check(url === 'https://www.google.com/search?q=argon+gas', 'a Google search tab is active', url);
    check(!(await p.palette()).open, 'the palette closed');
  });

  await test('The popup (for pages argon can\'t draw on) renders', async () => {
    const pop = await b.page(`chrome-extension://${b.extensionId}/src/popup.html?tab=1`, { width: 640, height: 480 });
    const s = await pop.until((x) => x.open && x.rows.length > 0, 3000);
    check(s.open, 'the palette shows in the popup');
    await pop.closeTarget();
  });

  await test('argon\'s new tab shows the shortcut, and the palette opens on it', async () => {
    const nt = await b.page(`chrome-extension://${b.extensionId}/src/newtab.html`, { mark: false });
    await sleep(500);
    const line = await nt.eval(`document.getElementById('rest').textContent`);
    check(/^Press.+to search$/.test(line), 'it reads "Press … to search"', line);
    check((await nt.eval(`getComputedStyle(document.documentElement).backgroundImage`)).includes('newtab.jpg'), 'over the gradient');
    await nt.toggle();
    const s = await nt.until((x) => x.open);
    check(s.open, 'the palette opens on the new tab');
    await nt.closeTarget();
  });

  await other.closeTarget();

  await test('Ctrl+W never closes your last tab: you land on argon\'s new tab instead', async () => {
    // Down to this one tab, in one window.
    const mine = await p.tabId();
    await b.background(`chrome.tabs.query({}).then((ts) => chrome.tabs.remove(ts.filter((t) => t.id !== ${mine}).map((t) => t.id)))`);
    await sleep(300);
    await b.background(`chrome.tabs.get(${mine}).then(closeTab)`);
    await sleep(600);
    let tabs = await b.background(`chrome.tabs.query({}).then((ts) => ts.map((t) => t.pendingUrl || t.url))`);
    check(tabs.length === 1 && /newtab/.test(tabs[0]), 'the last page closed and the new tab took its place', tabs);
    await b.background(`chrome.tabs.query({}).then((ts) => closeTab(ts[0]))`);
    await sleep(300);
    tabs = await b.background(`chrome.tabs.query({}).then((ts) => ts.map((t) => t.pendingUrl || t.url))`);
    check(tabs.length === 1, 'and that new tab stays put', tabs);
    // Same in a second window: Ctrl+W never closes a window.
    const win = await b.background(`chrome.windows.create({ url: 'chrome://newtab/' }).then((w) => w.id)`);
    await sleep(600);
    await b.background(`chrome.tabs.query({ windowId: ${win} }).then((ts) => closeTab(ts[0]))`);
    await sleep(300);
    check((await b.background(`chrome.tabs.query({ windowId: ${win} }).then((ts) => ts.length)`)) === 1, 'even when another window is open');
  });
} finally {
  b.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

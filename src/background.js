// argon background worker: opens the palette on the current tab, ranks history, resolves !bangs, fetches
// Google suggestions and opens whatever you pick.

const PALETTE_FILE = 'src/palette.js';
const POPUP = 'src/popup.html';
const BANGS_URL = 'https://services.helium.imput.net/bangs.json'; // the same list Helium's address bar uses
const BANGS_MAX_AGE = 3 * 24 * 3600e3;
const DAY = 24 * 3600e3;

const NEWTAB = chrome.runtime.getURL('src/newtab.html');
const isBlank = (url = '') =>
  /^(chrome|edge|brave|helium):\/\/(newtab|new-tab-page)\b/.test(url) || url === 'about:blank' || url === '' || url.startsWith(NEWTAB);

// ---------- Opening the palette ----------

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (cmd === 'close-tab') return closeTab(tab);
  if (cmd !== 'open-palette') return;
  toggle(tab);
  saveShortcut();
});

// Ctrl+W (once you bind it to argon): closing the last tab of your last window would quit Helium, so you land on
// argon's new tab instead, and that one stays put. Every other tab closes as usual.
async function closeTab(tab) {
  if (!tab) return;
  // Ctrl+W never closes a window: its last page turns into argon's new tab, and that new tab stays.
  const [tabs, win] = await Promise.all([chrome.tabs.query({ windowId: tab.windowId }), chrome.windows.get(tab.windowId)]);
  if (tabs.length > 1 || win.type !== 'normal') return chrome.tabs.remove(tab.id);
  if (isBlank(tab.pendingUrl || tab.url)) return;
  // Opened by its own address, not chrome://newtab/, so the page gets focus instead of the address bar: Ctrl+T then opens the palette right there.
  await chrome.tabs.create({ windowId: tab.windowId, url: NEWTAB });
  await chrome.tabs.remove(tab.id);
}
chrome.action.onClicked.addListener(toggle);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome.html') });
});

// Pages watch for your shortcut's key being let go (the browser swallows the key press itself), so they can open
// the palette without waiting for this worker to wake up. They need to know which key that is.
async function saveShortcut() {
  const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'open-palette');
  const shortcut = cmd?.shortcut || '';
  const { shortcut: saved } = await chrome.storage.local.get('shortcut');
  if (saved !== shortcut) await chrome.storage.local.set({ shortcut });
}
saveShortcut();

// The toolbar popup (used on pages no extension can draw on) keeps a port open, so a second Ctrl+T closes it.
const popups = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return;
  popups.add(port);
  port.onDisconnect.addListener(() => popups.delete(port));
});

async function toggle(tab) {
  if (!tab) return;
  if (popups.size) return popups.forEach((p) => p.postMessage({ type: 'close' }));

  // Already in the page (it's loaded on every page as it starts): just toggle it. Nothing else runs first.
  const reply = await chrome.tabs.sendMessage(tab.id, { type: 'toggle' }, { frameId: 0 }).catch(() => null);
  warm(); // load history while you start typing
  if (reply === 'ok') return;

  // Pages opened before argon was installed or updated don't have it yet: inject it, and it opens itself.
  if (reply !== 'nofocus') {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: [PALETTE_FILE] });
      if (res?.result === true) return;
    } catch { /* the browser's own pages, the Web Store and PDFs can't be drawn on by any extension */ }
  }

  // Drop the palette down from the toolbar instead. Also used when focus is in the address bar, since no page
  // can take keyboard focus from there.
  await chrome.action.setPopup({ tabId: tab.id, popup: `${POPUP}?tab=${tab.id}` });
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
  } catch { /* window not focused */ } finally {
    chrome.action.setPopup({ tabId: tab.id, popup: '' }); // clicking the icon goes back to the normal palette
  }
}

// ---------- Messages from the palette ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg.tabId ?? sender.tab?.id;
  let run;
  if (msg.type === 'query') run = query(msg.q, tabId);
  else if (msg.type === 'suggest') run = suggest(msg.q);
  else if (msg.type === 'open') run = msg.row ? openRow(msg.row, msg.mode, tabId) : open(msg.url, msg.mode, tabId);
  else if (msg.type === 'go') run = query(msg.q, tabId).then((rows) => rows[0] && openRow(rows[0], msg.mode, tabId));
  else if (msg.type === 'remove') run = remove(msg.row);
  else if (msg.type === 'ping') run = Promise.resolve(warm()).then(() => true);
  else if (msg.type === 'shortcuts') run = chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  if (!run) return;
  run.then((r) => reply(r ?? true), (e) => reply({ error: String(e) }));
  return true;
});

// ---------- Opening results ----------

// An open tab is switched to rather than opened again. Leaving a blank tab for it closes the blank tab.
async function openRow(row, mode, tabId) {
  if (row.kind === 'command') return runCommand(row.id, tabId);
  if (row.kind !== 'tab') return open(row.url, mode, tabId);
  const target = await chrome.tabs.get(row.tabId).catch(() => null);
  if (!target) return open(row.url, mode, tabId);
  await chrome.tabs.update(target.id, { active: true });
  await chrome.windows.update(target.windowId, { focused: true });
  const origin = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (origin && origin.id !== target.id && isBlank(origin.url)) chrome.tabs.remove(origin.id).catch(() => {});
}

// mode: 'new' (default: a new tab next to this one, like Ctrl+T would have), 'here' (this tab),
// 'background' (a new tab you don't switch to). A blank tab is always reused.
async function open(url, mode = 'new', tabId) {
  if (!url) return;
  const origin = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (origin && (mode === 'here' || isBlank(origin.url))) {
    await chrome.tabs.update(origin.id, { url, active: true });
    return;
  }
  await chrome.tabs.create({
    url,
    windowId: origin?.windowId,
    index: origin ? origin.index + 1 : undefined,
    openerTabId: mode === 'background' ? origin?.id : undefined,
    active: mode !== 'background'
  });
}

// ---------- Commands ----------

// Typing ">" lists these; a search that clearly names one ("dupl") shows it too. `tab` commands act on the tab
// the palette was opened on, and need a real page there. `page` commands run in the page itself (they need the
// keypress that ran them: copying, picture-in-picture), so the palette runs those without a round trip.
const COMMANDS = [
  { id: 'pin', icon: 'pin', tab: true, title: (t) => (t.pinned ? 'Unpin Tab' : 'Pin Tab'), words: 'pin unpin' },
  { id: 'duplicate', icon: 'duplicate', tab: true, title: 'Duplicate Tab', words: 'duplicate clone copy' },
  { id: 'mute', icon: 'sound', tab: true, title: (t) => (t.mutedInfo?.muted ? 'Unmute Tab' : 'Mute Tab'), words: 'mute unmute sound audio silence' },
  { id: 'reload', icon: 'reload', tab: true, title: 'Reload Tab', words: 'reload refresh' },
  { id: 'close', icon: 'close', tab: true, title: 'Close Tab', words: 'close' },
  { id: 'copy', icon: 'copy', tab: true, page: true, title: 'Copy Link', words: 'copy link url address share' },
  { id: 'copy-md', icon: 'copy', tab: true, page: true, title: 'Copy as Markdown Link', words: 'copy markdown link md' },
  { id: 'pip', icon: 'pip', tab: true, page: true, title: 'Picture-in-Picture', words: 'picture in pip video float' },
  { id: 'move', icon: 'window', tab: true, title: 'Move Tab to New Window', words: 'move detach new window' },
  { id: 'reopen', icon: 'restore', title: 'Reopen Closed Tab', words: 'reopen restore undo closed' },
  { id: 'close-others', icon: 'close', tab: true, title: 'Close Other Tabs', words: 'close other tabs' },
  { id: 'close-right', icon: 'close', tab: true, title: 'Close Tabs to the Right', words: 'close tabs right' },
  { id: 'unload', icon: 'sleep', title: 'Unload Other Tabs', words: 'unload sleep discard memory free other tabs' },
  { id: 'zoom-in', icon: 'zoom', tab: true, title: 'Zoom In', words: 'zoom in bigger larger' },
  { id: 'zoom-out', icon: 'zoom', tab: true, title: 'Zoom Out', words: 'zoom out smaller' },
  { id: 'zoom-reset', icon: 'zoom', tab: true, title: 'Reset Zoom', words: 'reset zoom actual size' },
  { id: 'window', icon: 'window', title: 'New Window', words: 'new window' },
  { id: 'incognito', icon: 'incognito', title: 'New Incognito Window', words: 'new incognito private window' },
  { id: 'history', icon: 'history', title: 'Open History', words: 'history', url: 'chrome://history' },
  { id: 'downloads', icon: 'download', title: 'Open Downloads', words: 'downloads', url: 'chrome://downloads' },
  { id: 'extensions', icon: 'puzzle', title: 'Open Extensions', words: 'extensions addons', url: 'chrome://extensions' },
  { id: 'shortcuts', icon: 'keyboard', title: 'Keyboard Shortcuts', words: 'keyboard shortcuts keys hotkeys', url: 'chrome://extensions/shortcuts' },
  { id: 'settings', icon: 'gear', title: 'Browser Settings', words: 'settings preferences options', url: 'chrome://settings' }
];

function commandRows(text, origin) {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  const onPage = origin && /^(https?|file):/.test(origin.url || '');
  return COMMANDS
    .filter((c) => !c.tab || onPage)
    .map((c) => ({ ...c, title: typeof c.title === 'function' ? c.title(origin) : c.title }))
    .filter((c) => {
      const words = `${c.title} ${c.words}`.toLowerCase().split(/[\s-]+/);
      return terms.every((term) => words.some((w) => w.startsWith(term)));
    })
    .map((c) => ({
      kind: 'command', id: c.id, icon: c.icon, title: c.title, page: !!c.page,
      // What page commands need to do their work in the page.
      ...(c.page ? { url: origin.url, pageTitle: origin.title } : {})
    }));
}

// The one command a search clearly names: its title (or one of its words) starts with everything you typed.
function namedCommand(phrase, origin) {
  if (phrase.length < 3) return null;
  return commandRows(phrase, origin).find((c) => c.title.toLowerCase().startsWith(phrase)) || null;
}

async function runCommand(id, tabId) {
  const t = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd || (cmd.tab && !t)) return;
  const others = async (filter) => (await chrome.tabs.query({ windowId: t.windowId })).filter((x) => x.id !== t.id && !x.pinned && filter(x));
  const zoom = async (f) => chrome.tabs.setZoom(t.id, f(await chrome.tabs.getZoom(t.id)));
  const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  switch (id) {
    case 'pin': return chrome.tabs.update(t.id, { pinned: !t.pinned });
    case 'duplicate': return chrome.tabs.duplicate(t.id);
    case 'mute': return chrome.tabs.update(t.id, { muted: !t.mutedInfo?.muted });
    case 'reload': return chrome.tabs.reload(t.id);
    case 'close': return closeTab(t);
    case 'move': return chrome.windows.create({ tabId: t.id });
    case 'reopen': return chrome.sessions.restore();
    case 'close-others': return chrome.tabs.remove((await others(() => true)).map((x) => x.id));
    case 'close-right': return chrome.tabs.remove((await others((x) => x.index > t.index)).map((x) => x.id));
    case 'unload': {
      // Every tab you're not looking at, except ones playing sound, gives its memory back until you return.
      const tabs = await chrome.tabs.query({ active: false, discarded: false, audible: false });
      return Promise.all(tabs.map((x) => chrome.tabs.discard(x.id).catch(() => {})));
    }
    case 'zoom-in': return zoom((z) => steps.find((s) => s > z + 0.01) ?? z);
    case 'zoom-out': return zoom((z) => [...steps].reverse().find((s) => s < z - 0.01) ?? z);
    case 'zoom-reset': return chrome.tabs.setZoom(t.id, 0);
    case 'window': return chrome.windows.create({});
    case 'incognito': return chrome.windows.create({ incognito: true });
    default: return cmd.url && chrome.tabs.create({ url: cmd.url, windowId: t?.windowId, index: t ? t.index + 1 : undefined });
  }
}

// ---------- Calculator ----------

// "12*7", "(3+4)^2/7", "1.5 × 4": answered instantly, with no network. Enter copies the result.
function calculate(text) {
  const src = text.replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/\s+/g, '');
  if (!/^[\d.+\-*/^()]+$/.test(src) || !/\d/.test(src) || !/\d[+\-*/^]|\)[+\-*/^(\d]|\d\(/.test(src)) return null;
  if (/^[\d-]+$/.test(src)) return null; // dates and phone numbers (2026-10-07, 555-1234) aren't sums
  let i = 0;
  const peek = () => src[i];
  const number = () => {
    const m = src.slice(i).match(/^\d*\.?\d+/);
    if (!m) throw 0;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const atom = () => {
    if (peek() === '-') { i++; return -atom(); }
    if (peek() === '+') { i++; return atom(); }
    if (peek() === '(') {
      i++;
      const v = sum();
      if (peek() !== ')') throw 0;
      i++;
      return v;
    }
    return number();
  };
  const power = () => {
    const base = atom();
    if (peek() === '^') { i++; return base ** power(); }
    return base;
  };
  const product = () => {
    let v = power();
    for (;;) {
      if (peek() === '*') { i++; v *= power(); }
      else if (peek() === '/') { i++; v /= power(); }
      else if (peek() === '(') v *= power(); // 2(3+4)
      else return v;
    }
  };
  const sum = () => {
    let v = product();
    for (;;) {
      if (peek() === '+') { i++; v += product(); }
      else if (peek() === '-') { i++; v -= product(); }
      else return v;
    }
  };
  try {
    const v = sum();
    if (i !== src.length || !Number.isFinite(v)) return null;
    return String(parseFloat(v.toPrecision(12)));
  } catch { return null; }
}

// ---------- URLs ----------

function looksLikeUrl(q) {
  if (/\s/.test(q)) return false;
  return /^[a-z][\w+.-]*:\/\//i.test(q) || /^(about|chrome|edge|helium|view-source|data|file):/i.test(q) ||
    /^localhost(:\d+)?(\/|$)/i.test(q) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(q) ||
    /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(q);
}
const toUrl = (q) => (/^[a-z][\w+.-]*:/i.test(q) && !/^localhost:/i.test(q) ? q : (/^(localhost|\d)/i.test(q) ? 'http://' : 'https://') + q);
const cleanUrl = (u = '') => u.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
const googleUrl = (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q).replace(/%20/g, '+');

// Past searches: the query behind a search results page, so it can be suggested as a search again.
const ENGINES = [
  [/(^|\.)google\.[a-z.]+$/, /^\/search/, 'q', 'Google'],
  [/(^|\.)bing\.com$/, /^\/search/, 'q', 'Bing'],
  [/(^|\.)duckduckgo\.com$/, /^\/$/, 'q', 'DuckDuckGo'],
  [/(^|\.)search\.brave\.com$/, /^\/search/, 'q', 'Brave'],
  [/(^|\.)kagi\.com$/, /^\/search/, 'q', 'Kagi'],
  [/(^|\.)youtube\.com$/, /^\/results/, 'search_query', 'YouTube']
];
function searchOf(url) {
  if (!/[?&](q|search_query)=/.test(url)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  for (const [host, path, param, engine] of ENGINES) {
    if (!host.test(u.hostname) || !path.test(u.pathname)) continue;
    const q = u.searchParams.get(param)?.trim().replace(/\s+/g, ' ');
    if (!q || q.length > 200) return null;
    // Google searches are suggested again as clean Google searches; other engines keep their own page.
    return { q, engine, url: engine === 'Google' ? googleUrl(q) : url };
  }
  return null;
}

// ---------- History index ----------

// Your history is loaded into memory once, so ranking runs on every keystroke without waiting on the browser.
// Until it's ready (right after the worker starts), the browser's own history search fills in.
let index = null;
let indexing = null;

function warm() {
  setTimeout(loadBangs, 250); // parsing the bang list takes a moment: not while the first results are being made
  return (indexing ??= buildIndex().catch(() => { indexing = null; }));
}

function entry(h) {
  const url = h.url || '';
  if (!/^(https?|file):/i.test(url)) return null;
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  const search = searchOf(url);
  const title = (search ? search.q : h.title || '').trim();
  return {
    url, host, title, search,
    tl: title.toLowerCase(), cl: cleanUrl(url).toLowerCase(),
    visits: h.visitCount || 1, typed: h.typedCount || 0, last: h.lastVisitTime || 0
  };
}

async function buildIndex() {
  const items = await chrome.history.search({ text: '', startTime: Date.now() - 365 * DAY, maxResults: 25000 });
  index = new Map();
  for (const h of items) {
    const e = entry(h);
    if (e) index.set(e.url, e);
  }
}

chrome.history.onVisited.addListener((h) => {
  if (!index) return;
  const e = entry(h);
  if (e) index.set(e.url, e);
});
chrome.history.onVisitRemoved.addListener(({ allHistory, urls }) => {
  if (allHistory) index = new Map();
  else urls?.forEach((u) => index?.delete(u));
});

async function historyItems(q) {
  if (index) return index.values();
  warm();
  const items = await chrome.history.search({ text: q, startTime: 0, maxResults: 400 });
  return items.map(entry).filter(Boolean);
}

// ---------- Ranking ----------

const WORD = /[\s\-_.,:;/|()[\]"'!?&+]/;
const URL_SEP = /[./\-_?=&#:]/;

// Where a typed word lands at the start of a word in `text` (-1 if it doesn't).
function wordStart(text, term, sep) {
  for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + 1)) {
    if (i === 0 || sep.test(text[i - 1])) return i;
  }
  return -1;
}

// How well every typed word matches the start of a word in the title (or past search) or address. 0 = no match.
function matchScore(terms, phrase, e) {
  let s = 0;
  for (const term of terms) {
    const t = wordStart(e.tl, term, WORD);
    const h = e.host.startsWith(term);
    const u = h ? 0 : wordStart(e.cl, term, URL_SEP);
    if (t < 0 && !h && u < 0) return 0;
    s += Math.max(t === 0 ? 5 : t > 0 ? 3 : 0, h ? 4 : u >= 0 ? 2 : 0);
  }
  if (e.tl.startsWith(phrase)) s += 4;
  if (e.host.startsWith(phrase) || e.cl.startsWith(phrase)) s += 4;
  return s;
}

function frecency(e, now) {
  return Math.log2(1 + e.visits) + 1.5 * Math.log2(1 + e.typed) + 3 * Math.exp(-(now - e.last) / (14 * DAY));
}

// Inline autofill: what you're most likely typing, completed in the search field.
// A past search ("how to ce" -> "how to center a div"), a site ("you" -> "youtube.com") or an address.
function autofill(q, phrase, list, now) {
  if (!phrase) return null;
  const domainish = !/\s/.test(phrase);
  const hosts = new Map();
  let best = null;
  const consider = (c) => {
    if (c.text.length <= phrase.length) return;
    if (!best || c.weight > best.weight || (c.weight === best.weight && c.text.length < best.text.length)) best = c;
  };
  for (const e of list) {
    const w = frecency(e, now);
    if (e.search) {
      if (e.tl.startsWith(phrase)) consider({ text: e.title, weight: w + 1, row: searchRow(e) });
    } else if (domainish) {
      if (e.host.startsWith(phrase)) {
        const h = hosts.get(e.host) || { weight: 0, url: new URL(e.url).origin + '/' };
        h.weight += w;
        hosts.set(e.host, h);
      } else if (phrase.includes('/') && e.cl.startsWith(phrase)) {
        consider({ text: cleanUrl(e.url), weight: w, row: pageRow(e) });
      }
    }
  }
  for (const [host, h] of hosts) {
    consider({ text: host, weight: h.weight + 2, row: { kind: 'url', title: host, subtitle: '', url: h.url, fill: host } });
  }
  if (!best) return null;
  // Keep what you typed as you typed it; only the rest is filled in.
  return { ...best.row, complete: q + best.text.slice(q.length) };
}

const searchRow = (e) => ({
  kind: 'history', title: e.search.q, subtitle: e.search.engine === 'Google' ? '' : e.search.engine,
  url: e.search.url, fill: e.search.q, removable: true, engine: e.search.engine
});
const pageRow = (e) => ({ kind: 'page', title: e.title || cleanUrl(e.url), subtitle: e.title ? cleanUrl(e.url) : '', url: e.url, fill: e.url, removable: true });
const tabRow = (t) => ({ kind: 'tab', title: t.title || cleanUrl(t.url), subtitle: cleanUrl(t.url), url: t.url, fill: t.url, tabId: t.tabId, windowId: t.windowId });
const googleRow = (q) => ({ kind: 'google', title: q, subtitle: 'Google Search', url: googleUrl(q), fill: q });

// ---------- Open tabs ----------

// Open tabs, kept until a tab opens, closes, changes or is switched to.
let tabsCache = null;
for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated,
  chrome.tabs.onReplaced, chrome.tabs.onAttached, chrome.tabs.onDetached]) ev.addListener(() => { tabsCache = null; });

// Every open page except the one you're on, as history-like entries, most recently used first.
async function openTabs(tabId) {
  const tabs = await (tabsCache ??= chrome.tabs.query({}));
  const out = [];
  for (const t of tabs) {
    if (t.id === tabId || isBlank(t.url) || !t.url) continue;
    const e = entry({ url: t.url, title: t.title, visitCount: 1, lastVisitTime: t.lastAccessed || 0 });
    if (e && !e.search) out.push({ ...e, tabId: t.id, windowId: t.windowId });
  }
  return out.sort((a, b) => b.last - a.last);
}

// ---------- Building results ----------

async function query(raw, tabId) {
  const q = raw.replace(/^\s+/, '').replace(/\s+/g, ' ');
  const trimmed = q.trim();
  if (!trimmed) return recent(tabId);
  const here = () => (tabId != null ? chrome.tabs.get(tabId).catch(() => null) : null);

  // Command mode: ">" lists everything argon can do to this tab and the browser.
  if (trimmed.startsWith('>')) return commandRows(trimmed.slice(1), await here());

  // !bangs, exactly like Helium's address bar: "!yt cats", "cats !yt", or a bang being typed.
  const bang = await bangRows(q);
  if (bang) return bang;

  const phrase = trimmed.toLowerCase();
  const terms = phrase.split(' ');
  const now = Date.now();
  const [items, tabs, origin] = await Promise.all([historyItems(trimmed), openTabs(tabId), here()]);
  const scored = [];
  for (const e of items) {
    const m = matchScore(terms, phrase, e);
    if (m) scored.push({ e, score: m + 0.8 * frecency(e, now) });
  }
  // Open tabs that match rank with your history, a little ahead of it.
  for (const t of tabs) {
    const m = matchScore(terms, phrase, t);
    if (m) scored.push({ e: t, score: m + 6 + 3 * Math.exp(-(now - t.last) / DAY) });
  }
  scored.sort((a, b) => b.score - a.score);

  // A page that's already open is switched to instead of opened a second time.
  const openAt = new Map();
  for (const t of tabs) if (!openAt.has(t.cl)) openAt.set(t.cl, t);
  const asTab = (r) => {
    if (r.kind !== 'page' && r.kind !== 'url') return r;
    const t = openAt.get(cleanUrl(r.url).toLowerCase());
    return t ? { ...tabRow(t), complete: r.complete } : r;
  };

  const rows = [];
  const seen = new Set();
  const pages = new Map(); // address without its ?query -> row, so tracking or bot-check variants of a page don't pile up
  const add = (row) => {
    const r = asTab(row);
    const key = r.kind === 'history' || r.kind === 'google' ? 's:' + r.title.toLowerCase() : 'u:' + cleanUrl(r.url).toLowerCase();
    if (seen.has(key)) return false;
    if (r.kind === 'page') {
      const path = cleanUrl(r.url.replace(/[?#].*$/, '')).toLowerCase();
      const same = pages.get(path);
      if (same) {
        // Keep the plainer address of the two.
        if (r.url.length < same.url.length) {
          rows[rows.indexOf(same)] = r;
          pages.set(path, r);
          seen.add(key);
        }
        return false;
      }
      pages.set(path, r);
    }
    seen.add(key);
    rows.push(r);
    return true;
  };
  seen.add('s:' + phrase); // searching exactly what you typed is the Google row, below

  // Arithmetic is answered on the spot, first.
  const answer = calculate(trimmed);
  if (answer) rows.push({ kind: 'answer', title: '= ' + answer, subtitle: 'Calculator', copy: answer, action: 'Copy', url: googleUrl(trimmed), fill: trimmed });

  // A full address you typed that you've been to (or have open) goes first, exactly as typed: no autofill.
  const typedUrl = looksLikeUrl(trimmed) ? cleanUrl(toUrl(trimmed)).toLowerCase() : null;
  const exact = typedUrl && (openAt.get(typedUrl) || scored.find((s) => s.e.cl === typedUrl)?.e);
  if (exact) add(exact.tabId ? tabRow(exact) : pageRow(exact));

  // Otherwise, typing what you'd normally type in the address bar: autofill it from history. A site you
  // have open ("you" -> youtube.com) switches to that tab.
  const fill = !exact && autofill(trimmed, phrase, scored.filter((s) => !s.e.tabId).map((s) => s.e), now);
  if (fill) {
    const host = fill.kind === 'url' && fill.title;
    const tab = host && tabs.find((t) => t.host === host);
    add(tab ? { ...tabRow(tab), complete: fill.complete } : fill);
  }

  // Everything else: open tabs, past searches and pages, best first.
  const max = 5;
  for (const { e } of scored) {
    if (rows.length >= max) break;
    add(e.tabId ? tabRow(e) : e.search ? searchRow(e) : pageRow(e));
  }

  if (typedUrl) {
    const url = toUrl(trimmed);
    const row = { kind: 'url', title: trimmed, subtitle: 'Open address', url, fill: trimmed };
    if (add(row) && !fill && !exact) rows.unshift(rows.pop()); // a typed address with nothing to fill opens first
  }

  // And always: search Google for it.
  rows.push(googleRow(trimmed));

  // A command you're clearly naming ("dupl" -> Duplicate Tab) comes right after.
  const named = !typedUrl && !answer && namedCommand(phrase, origin);
  if (named) rows.push(named);
  return rows;
}

// With nothing typed: a few tabs you were just on, then your most recent searches and pages.
async function recent(tabId) {
  const [items, tabs, here] = await Promise.all([
    chrome.history.search({ text: '', startTime: 0, maxResults: 80 }),
    openTabs(tabId),
    tabId != null ? chrome.tabs.get(tabId).catch(() => null) : null
  ]);
  const rows = [];
  const seen = new Set(here?.url ? ['u:' + cleanUrl(here.url).toLowerCase()] : []);
  for (const t of tabs.slice(0, 3)) {
    seen.add('u:' + t.cl);
    rows.push(tabRow(t));
  }
  const openAt = new Map(tabs.map((t) => [t.cl, t]));
  for (const h of items) {
    if (rows.length >= 7) break;
    const e = entry(h);
    if (!e) continue;
    const key = e.search ? 's:' + e.tl : 'u:' + e.cl;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(e.search ? searchRow(e) : openAt.has(e.cl) ? tabRow(openAt.get(e.cl)) : pageRow(e));
  }
  return rows;
}

// Shift+Delete: forget a past search (every time you searched it) or a page.
async function remove(row) {
  if (!row?.removable) return false;
  let urls = [row.url];
  if (row.kind === 'history') {
    const q = row.title.toLowerCase();
    const pool = index ? [...index.values()] : (await chrome.history.search({ text: row.title, startTime: 0, maxResults: 500 })).map(entry).filter(Boolean);
    urls = pool.filter((e) => e.search && e.search.q.toLowerCase() === q && e.search.engine === row.engine).map((e) => e.url);
  }
  await Promise.all(urls.map((url) => chrome.history.deleteUrl({ url })));
  urls.forEach((u) => index?.delete(u));
  return true;
}

// ---------- Google suggestions ----------

const suggestCache = new Map();
let suggestAbort = null;

async function suggest(raw) {
  const q = raw.trim().replace(/\s+/g, ' ');
  if (!q || looksLikeUrl(q) || /(^|\s)!\S*$/.test(q)) return [];
  // With a bang, suggest searches for the words around it, on the bang's site.
  const bang = parseBang(q, await loadBangs());
  if (bang) {
    if (!bang.terms) return [];
    const [name, template] = bang.site;
    return (await googleSuggest(bang.terms))
      .filter((r) => r.kind === 'suggest')
      .map((r) => ({ ...r, url: bangUrl(template, r.title), action: `Search ${name}`, fill: bang.fillWith(r.title) }));
  }
  return googleSuggest(q);
}

async function googleSuggest(q) {
  if (suggestCache.has(q)) return suggestCache.get(q);
  suggestAbort?.abort();
  const ctrl = (suggestAbort = new AbortController());
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const hl = chrome.i18n.getUILanguage();
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&ie=UTF-8&oe=UTF-8&hl=${hl}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
    const [, list = [], descs = [], , meta = {}] = await res.json();
    const types = meta['google:suggesttype'] || [];
    const rows = [];
    list.forEach((text, i) => {
      const type = types[i] || 'QUERY';
      if (type === 'CALCULATOR') {
        rows.push({ kind: 'answer', title: text, subtitle: descs[i] || 'Calculator', url: googleUrl(q), fill: q });
      } else if (type === 'NAVIGATION') {
        rows.push({ kind: 'url', title: cleanUrl(text), subtitle: descs[i] || '', url: text, fill: text });
      } else if (text.toLowerCase() !== q.toLowerCase()) {
        rows.push({ kind: 'suggest', title: text, subtitle: '', url: googleUrl(text), fill: text });
      }
    });
    const out = rows.slice(0, 6);
    suggestCache.set(q, out);
    if (suggestCache.size > 200) suggestCache.delete(suggestCache.keys().next().value);
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ---------- !bangs ----------

// Helium's own bang list ships with argon (data/bangs.json) and is refreshed from Helium's servers every few
// days, so new bangs keep working.
let bangs = null;

function loadBangs() {
  return (bangs ??= (async () => {
    const { bangList } = await chrome.storage.local.get('bangList');
    if (bangList?.data) {
      if (Date.now() - bangList.at > BANGS_MAX_AGE) refreshBangs();
      return bangList.data;
    }
    refreshBangs();
    return (await fetch(chrome.runtime.getURL('data/bangs.json'))).json();
  })().catch(() => { bangs = null; return { s: [], t: {} }; }));
}

async function refreshBangs() {
  try {
    const text = await (await fetch(BANGS_URL, { signal: AbortSignal.timeout(15000) })).text();
    const list = JSON.parse(text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').replace(/,(\s*[\]}])/g, '$1'));
    const data = { s: [], t: {} };
    for (const b of list) {
      if (typeof b?.s !== 'string' || typeof b.u !== 'string' || !/^https?:\/\//i.test(b.u) || !Array.isArray(b.ts)) continue;
      const i = data.s.push([b.s, b.u]) - 1;
      for (const t of b.ts) {
        const k = String(t).toLowerCase();
        if (k && !/\s/.test(k) && !(k in data.t)) data.t[k] = i;
      }
    }
    if (data.s.length < 1000) return; // something went wrong upstream: keep what we have
    await chrome.storage.local.set({ bangList: { at: Date.now(), data } });
    bangs = Promise.resolve(data);
  } catch { /* offline: the bundled list keeps working */ }
}

// Fill a bang's template the way Chromium fills a search engine's: + for spaces in the query, %20 in the path.
function bangUrl(template, terms) {
  if (!terms) return new URL(template.replace('{searchTerms}', '')).origin + '/'; // "!yt" alone opens the site
  const at = template.indexOf('{searchTerms}');
  const q = template.indexOf('?');
  const enc = encodeURIComponent(terms);
  return template.replace('{searchTerms}', q >= 0 && q < at ? enc.replace(/%20/g, '+') : enc);
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

function bangRow(data, trigger, terms, fill) {
  const [name, template] = data.s[data.t[trigger]];
  const url = bangUrl(template, terms);
  return {
    kind: 'bang', title: terms || name, subtitle: terms ? `!${trigger} · ${name}` : `!${trigger} · ${hostOf(url)}`,
    action: terms ? `Search ${name}` : `Open ${name}`, url, icon: new URL(url).origin + '/', fill
  };
}

// Helium treats the first "!" as a bang when it starts the text or follows a space: "!w cats" or "cats !w".
function splitBang(q) {
  const i = q.indexOf('!');
  if (i < 0 || (i > 0 && !/\s/.test(q[i - 1]))) return null;
  const rest = q.slice(i + 1);
  const end = rest.search(/\s/);
  const trigger = (end < 0 ? rest : rest.slice(0, end)).toLowerCase();
  const terms = (q.slice(0, i) + ' ' + (end < 0 ? '' : rest.slice(end))).trim().replace(/\s+/g, ' ');
  const leading = i === 0;
  const fillFor = (t, words = terms) => (leading ? `!${t} ${words}` : `${words} !${t}`).trim() + (leading && !words ? ' ' : '');
  return { trigger, terms, typing: end < 0, fillFor };
}

// A bang Helium knows, with the words to search for.
function parseBang(q, data) {
  const b = splitBang(q);
  if (!b || data.t[b.trigger] === undefined) return null;
  return { ...b, site: data.s[data.t[b.trigger]], fillWith: (words) => b.fillFor(b.trigger, words) };
}

// Bangs people reach for most, suggested first while you type a bang (Helium's list has no popularity order).
const POPULAR = ['g', 'yt', 'w', 'gh', 'r', 'a', 'gi', 'gm', 'gt', 'so', 'mdn', 'npm', 'imdb', 'wa', 'ddg', 'b', 'x',
  'chatgpt', 't3', 'perplexity', 'claude', 'spotify', 'twitch', 'maps', 'e', 'gs', 'tw', 'pin', 'wiki', 'gd', 'reddit', 'amazon'];
const popularity = (t) => { const i = POPULAR.indexOf(t); return i < 0 ? 999 : i; };

async function bangRows(q) {
  const b = splitBang(q);
  if (!b) return null;
  const { trigger: typedTrigger, terms, typing, fillFor } = b;
  const data = await loadBangs();
  const exact = data.t[typedTrigger] !== undefined;

  if (!typing) {
    // A bang that Helium doesn't know is searched like any other text.
    if (!exact) return null;
    const rows = [bangRow(data, typedTrigger, terms, fillFor(typedTrigger))];
    if (terms) rows.push(googleRow(terms));
    return rows;
  }

  // Still typing the bang: suggest bangs that start with it (one per site, popular ones first).
  const rows = [];
  if (exact) rows.push(bangRow(data, typedTrigger, terms, fillFor(typedTrigger)));
  if (typedTrigger) {
    const bySite = new Map();
    for (const t in data.t) {
      if (t === typedTrigger || !t.startsWith(typedTrigger)) continue;
      const site = data.t[t];
      if (exact && site === data.t[typedTrigger]) continue;
      const cur = bySite.get(site);
      if (!cur || popularity(t) < popularity(cur) || (popularity(t) === popularity(cur) && t.length < cur.length)) bySite.set(site, t);
    }
    [...bySite]
      .sort((x, y) => popularity(x[1]) - popularity(y[1]) || x[1].length - y[1].length || x[0] - y[0])
      .slice(0, exact ? 5 : 6)
      .forEach(([, t]) => rows.push(bangRow(data, t, terms, fillFor(t))));
  }
  if (!rows.length) return null;
  rows.push(googleRow(terms || q.trim()));
  return rows;
}

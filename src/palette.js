// argon's command palette. Loaded into every page as it starts (so Ctrl+T opens it instantly), injected into
// pages that were open before argon was installed, and run by popup.html on pages no extension can draw on.
(() => {
  const old = window.__argon;
  if (old) {
    if (old.alive()) return old.toggle();
    old.destroy(); // a copy left over from before argon was reloaded can't reach argon anymore
  }
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  // The toolbar popup draws the palette as the whole window. argon's new tab page draws it like any page.
  const IN_POPUP = location.protocol === 'chrome-extension:' && location.pathname.endsWith('/popup.html');
  const POPUP_TAB = IN_POPUP ? Number(new URLSearchParams(location.search).get('tab')) || undefined : undefined;

  const send = (msg) => new Promise((resolve) => {
    if (!alive()) return resolve(null);
    try {
      chrome.runtime.sendMessage(POPUP_TAB ? { ...msg, tabId: POPUP_TAB } : msg, (r) => {
        void chrome.runtime.lastError;
        resolve(r ?? null);
      });
    } catch { resolve(null); }
  });

  const svg = (body) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON = {
    search: svg('<circle cx="8.75" cy="8.75" r="5.25"/><path d="m12.75 12.75 3.75 3.75"/>'),
    history: svg('<path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6"/><path d="M3.5 3.75V6.5h2.75"/><path d="M10 6.75V10l2.25 1.5"/>'),
    globe: svg('<circle cx="10" cy="10" r="6.75"/><path d="M3.25 10h13.5M10 3.25c2.1 2.3 2.1 11.2 0 13.5M10 3.25c-2.1 2.3-2.1 11.2 0 13.5"/>'),
    answer: svg('<rect x="4.25" y="3.25" width="11.5" height="13.5" rx="2.25"/><path d="M7 6.5h6M7.25 10h.01M10 10h.01M12.75 10h.01M7.25 13h.01M10 13h.01M12.75 13h.01"/>'),
    enter: svg('<path d="M15.5 4.5v5.25a2 2 0 0 1-2 2H5"/><path d="m7.75 8.5-3 3.25 3 3.25"/>'),
    // Commands
    command: svg('<path d="m6 6.5 3.5 3.5L6 13.5M11 14h4"/>'),
    pin: svg('<path d="M12 3.5 16.5 8M13 4.5 9.5 8l-3.5.5 5.5 5.5.5-3.5L15.5 7M8.25 11.75 4 16"/>'),
    duplicate: svg('<rect x="3.5" y="6" width="9.5" height="10.5" rx="2"/><path d="M7 3.5h7.5a2 2 0 0 1 2 2V13"/>'),
    sound: svg('<path d="M4 8v4h3l4 3.5v-11L7 8H4z"/><path d="M14 7.5a3.5 3.5 0 0 1 0 5M15.75 5.5a6 6 0 0 1 0 9"/>'),
    reload: svg('<path d="M15.75 10a5.75 5.75 0 1 1-1.7-4.1"/><path d="M14.5 3v3.5H11"/>'),
    close: svg('<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>'),
    copy: svg('<path d="M8.5 11.5 11.5 8.5M7 9.5 5.5 11a2.5 2.5 0 0 0 3.5 3.5l1.5-1.5M13 10.5 14.5 9A2.5 2.5 0 0 0 11 5.5L9.5 7"/>'),
    pip: svg('<rect x="3" y="4.5" width="14" height="11" rx="2"/><rect x="10" y="10" width="5" height="3.5" rx="1"/>'),
    window: svg('<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 7.5h14"/>'),
    restore: svg('<path d="M4.25 10a5.75 5.75 0 1 0 1.7-4.1"/><path d="M5.5 3v3.5H9"/>'),
    sleep: svg('<path d="M15.5 12.25A6.25 6.25 0 0 1 7.75 4.5a6.25 6.25 0 1 0 7.75 7.75z"/>'),
    zoom: svg('<circle cx="8.75" cy="8.75" r="5.25"/><path d="m12.75 12.75 3.75 3.75M6.75 8.75h4M8.75 6.75v4"/>'),
    incognito: svg('<path d="M3 10h14M5.5 10l1.5-5.5h6L14.5 10"/><circle cx="6.75" cy="13.5" r="2"/><circle cx="13.25" cy="13.5" r="2"/><path d="M8.75 13.5h2.5"/>'),
    download: svg('<path d="M10 3.5v9M6.25 8.75 10 12.5l3.75-3.75M4 16h12"/>'),
    puzzle: svg('<path d="M8 4.5a1.75 1.75 0 0 1 3.5 0V6H15v3.5h-1.5a1.75 1.75 0 0 0 0 3.5H15v3.5H4.5V13H6a1.75 1.75 0 0 0 0-3.5H4.5V6H8z"/>'),
    keyboard: svg('<rect x="2.75" y="5" width="14.5" height="10" rx="2"/><path d="M6 8.25h.01M9 8.25h.01M12 8.25h.01M14.25 8.25h.01M6.5 11.75h7"/>'),
    gear: svg('<circle cx="10" cy="10" r="2.5"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.4 1.4M13.55 13.55l1.4 1.4M5.05 14.95l1.4-1.4M13.55 6.45l1.4-1.4"/>')
  };
  const MAX_ROWS = 7; // the palette is exactly this many rows tall
  const ACTION = { google: 'Search Google', suggest: 'Search', history: 'Search', page: 'Open', url: 'Open', answer: 'Search Google', tab: 'Switch to Tab', command: 'Run' };

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --accent: #3450d1; --on-accent: #fff;
  --panel: rgba(250, 250, 251, 0.84); --panel-solid: #f6f6f7;
  --text: #1d1d1f; --muted: #6e6e73; --faint: #a1a1a6;
  --line: rgba(0, 0, 0, 0.08); --hover: rgba(0, 0, 0, 0.045); --tile: rgba(0, 0, 0, 0.05);
  --dim: rgba(15, 18, 20, 0.16);
  --shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.12), 0 24px 70px -12px rgba(0, 0, 0, 0.35), 0 10px 24px -10px rgba(0, 0, 0, 0.18);
  font: 400 14px/1.35 system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif;
  color: var(--text); -webkit-font-smoothing: antialiased; letter-spacing: -0.005em;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  .root {
    --accent: #3a57dc; --on-accent: #fff;
    --panel: rgba(30, 31, 34, 0.8); --panel-solid: #1f2023;
    --text: #f2f2f4; --muted: #9b9ba1; --faint: #6c6c72;
    --line: rgba(255, 255, 255, 0.09); --hover: rgba(255, 255, 255, 0.06); --tile: rgba(255, 255, 255, 0.07);
    --dim: rgba(0, 0, 0, 0.34);
    --shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.13), 0 28px 80px -12px rgba(0, 0, 0, 0.7), 0 12px 28px -10px rgba(0, 0, 0, 0.5);
    color-scheme: dark;
  }
}
.backdrop { position: fixed; inset: 0; background: var(--dim); }
/* Dead center, at a fixed height, so the field never moves as results come and go. */
.panel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(680px, calc(100vw - 32px)); height: min(367px, calc(100vh - 32px)); /* the field + exactly 7 rows */
  display: flex; flex-direction: column;
  background: var(--panel); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden;
  backdrop-filter: blur(36px) saturate(1.8); -webkit-backdrop-filter: blur(36px) saturate(1.8);
}

.field { display: flex; align-items: center; gap: 12px; height: 60px; flex: none; padding: 0 20px; }
.field > svg { width: 20px; height: 20px; flex: none; color: var(--muted); }
input {
  all: unset; flex: 1; min-width: 0; height: 100%;
  font-family: inherit; font-size: 19px; font-weight: 400; line-height: normal; color: var(--text); letter-spacing: -0.012em;
  caret-color: var(--accent);
}
input::placeholder { color: var(--faint); }
input::selection { background: color-mix(in srgb, var(--accent) 38%, transparent); color: var(--text); }

.list { list-style: none; margin: 0; padding: 6px; border-top: 1px solid var(--line); flex: 1; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.row {
  display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 12px 0 10px;
  border-radius: 10px; cursor: default; user-select: none; white-space: nowrap;
}
.row.hover { background: var(--hover); }
.row.sel { background: var(--accent); color: var(--on-accent); }
.icon { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 7px; background: var(--tile); color: var(--muted); }
.icon svg { width: 16px; height: 16px; }
.icon img { width: 16px; height: 16px; }
.row.sel .icon { background: rgba(255, 255, 255, 0.18); color: var(--on-accent); }
.text { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; overflow: hidden; }
.title { overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; font-weight: 450; }
.title b { font-weight: 640; }
.kind-suggest .title, .kind-google .title, .kind-history .title { font-weight: 400; }
.kind-answer .title { font-weight: 600; font-variant-numeric: tabular-nums; }
.sub { overflow: hidden; text-overflow: ellipsis; flex: 0 10000 auto; min-width: 0; color: var(--muted); font-size: 12.5px; }
.row.sel .sub { color: rgba(255, 255, 255, 0.78); }
.action { flex: none; display: none; align-items: center; gap: 6px; font-size: 12px; color: rgba(255, 255, 255, 0.85); }
.action svg { width: 14px; height: 14px; }
.row.sel .action { display: flex; }
/* Open tabs say so, until selected (then the action says "Switch to Tab"). */
.badge { flex: none; font-size: 11px; font-weight: 500; color: var(--muted); padding: 2px 7px; border-radius: 6px; background: var(--tile); }
.row.sel .badge { display: none; }

/* After a copy: a small note at the bottom of the page, gone by itself. */
.toast { display: none; position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%);
  padding: 9px 16px; border-radius: 10px; background: var(--panel); box-shadow: var(--shadow);
  backdrop-filter: blur(36px) saturate(1.8); -webkit-backdrop-filter: blur(36px) saturate(1.8);
  font-size: 13px; font-weight: 500; white-space: nowrap; }
.root.toasting .backdrop, .root.toasting .panel { display: none; }
.root.toasting .toast { display: block; }

/* The toolbar popup: no backdrop, the panel is the whole window. */
.root.popup .panel { position: static; transform: none; width: 640px; height: auto; border-radius: 0; box-shadow: none;
  background: var(--panel-solid); backdrop-filter: none; }
.root.popup .list { flex: none; }
.root.popup .list:empty { display: none; }
`;

  // ---------- DOM ----------

  const host = document.createElement('argon-palette');
  // Pages can't restyle the host: inline !important wins over anything a page's stylesheet says.
  host.setAttribute('style', [
    'all: initial', 'position: fixed', 'inset: 0', 'width: 100vw', 'height: 100vh', 'max-width: none', 'max-height: none',
    'margin: 0', 'padding: 0', 'border: 0', 'background: transparent', 'overflow: visible', 'z-index: 2147483647',
    'display: none', 'opacity: 1', 'visibility: visible', 'transform: none', 'filter: none', 'pointer-events: auto',
    'color-scheme: normal', 'contain: none'
  ].map((d) => d + ' !important').join(';'));
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = document.createElement('style');
  sheet.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'root' + (IN_POPUP ? ' popup' : '');
  root.innerHTML = `
    ${IN_POPUP ? '' : '<div class="backdrop"></div>'}
    <div class="panel" role="dialog" aria-label="Search">
      <label class="field">${ICON.search}<input type="text" spellcheck="false" autocomplete="off" autocapitalize="off"
        placeholder="Search, or type > for commands" aria-autocomplete="both" aria-controls="argon-list" role="combobox" aria-expanded="true"></label>
      <ul class="list" id="argon-list" role="listbox"></ul>
    </div>
    <div class="toast" role="status"></div>`;
  shadow.append(sheet, root);
  const input = root.querySelector('input');
  const list = root.querySelector('.list');
  const backdrop = root.querySelector('.backdrop');
  const toastEl = root.querySelector('.toast');
  let toastTimer = 0;

  // ---------- State ----------

  let isOpen = false;
  let typed = '';        // what you typed (the field can also show an autofill or a suggestion you Tabbed to)
  let rows = [];         // what's listed
  let rowsFor = null;    // the text `rows` were made for
  let local = [];        // history rows + Google row for `typed`
  let remote = [];       // Google suggestions for `typed`
  let sel = 0;
  let seq = 0;
  let allowFill = true;  // no autofill right after you delete
  let lastFocus = null;

  const faviconUrl = (url) => {
    try { return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`); } catch { return ''; }
  };

  // ---------- Rendering ----------

  // Bold the parts of the title that match what you typed.
  function highlight(el, text, kind) {
    const terms = typed.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length || kind === 'answer') return void (el.textContent = text);
    const lower = text.toLowerCase();
    // Search suggestions read like Google's: what you typed stays plain, the rest is bold.
    if (kind === 'suggest' || kind === 'history') {
      const t = typed.trim().toLowerCase();
      if (lower.startsWith(t) && text.length > t.length) {
        el.append(text.slice(0, t.length), Object.assign(document.createElement('b'), { textContent: text.slice(t.length) }));
        return;
      }
      return void (el.textContent = text);
    }
    if (kind === 'google') return void (el.textContent = text);
    const marks = new Array(text.length).fill(false);
    for (const term of terms) {
      for (let i = lower.indexOf(term); i >= 0; i = lower.indexOf(term, i + 1)) {
        if (i === 0 || /[\s\W_]/.test(lower[i - 1])) { marks.fill(true, i, i + term.length); break; }
      }
    }
    let i = 0;
    while (i < text.length) {
      let j = i;
      while (j < text.length && marks[j] === marks[i]) j++;
      const part = text.slice(i, j);
      el.append(marks[i] ? Object.assign(document.createElement('b'), { textContent: part }) : part);
      i = j;
    }
  }

  function iconFor(r) {
    const box = document.createElement('span');
    box.className = 'icon';
    const glyph = r.kind === 'google' || r.kind === 'suggest' ? ICON.search
      : r.kind === 'history' ? ICON.history : r.kind === 'answer' ? ICON.answer
      : r.kind === 'command' ? ICON[r.icon] || ICON.command : null;
    if (glyph) box.innerHTML = glyph;
    else {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = faviconUrl(r.icon || r.url);
      img.onerror = () => { box.innerHTML = ICON.globe; };
      box.append(img);
    }
    return box;
  }

  function render() {
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = `row kind-${r.kind}` + (i === sel ? ' sel' : '');
      li.setAttribute('role', 'option');
      li.id = 'argon-row-' + i;
      const text = document.createElement('span');
      text.className = 'text';
      const title = document.createElement('span');
      title.className = 'title';
      highlight(title, r.title, r.kind);
      text.append(title);
      if (r.subtitle) text.append(Object.assign(document.createElement('span'), { className: 'sub', textContent: r.subtitle }));
      const action = document.createElement('span');
      action.className = 'action';
      action.innerHTML = ICON.enter;
      action.prepend(r.action || ACTION[r.kind] || 'Open');
      li.append(iconFor(r), text, action);
      if (r.kind === 'tab') li.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: 'Tab' }));
      frag.append(li);
    });
    list.replaceChildren(frag);
    hoverIdx = -1;
    markSelected(false);
  }

  function markSelected(scroll = true) {
    const els = list.children;
    for (let i = 0; i < els.length; i++) els[i].classList.toggle('sel', i === sel);
    input.setAttribute('aria-activedescendant', rows[sel] ? 'argon-row-' + sel : '');
    if (scroll) els[sel]?.scrollIntoView({ block: 'nearest' });
  }

  // History first, then the Google search, then Google's suggestions (minus anything already listed).
  function merge() {
    // Picture-in-picture only where there's a video to float (and never from the toolbar popup).
    const usable = local.filter((r) => r.id !== 'pip' || (!IN_POPUP && document.querySelector('video')));
    // Command mode lists every command; the list scrolls.
    if (typed.trim().startsWith('>')) return usable;
    const seen = new Set(usable.map((r) => (r.kind === 'url' || r.kind === 'page' || r.kind === 'tab' ? 'u:' + r.url.replace(/\/$/, '')
      : r.kind === 'answer' ? 'a' : 's:' + r.title.toLowerCase())));
    const extra = remote.filter((r) => {
      const key = r.kind === 'url' ? 'u:' + r.url.replace(/\/$/, '') : r.kind === 'answer' ? 'a' : 's:' + r.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // A calculator answer goes right under the Google search.
    const answer = extra.filter((r) => r.kind === 'answer');
    const rest = extra.filter((r) => r.kind !== 'answer');
    return [...usable, ...answer, ...rest].slice(0, MAX_ROWS);
  }

  function show(keepSel) {
    const prev = rows[sel];
    rows = merge();
    rowsFor = typed;
    if (keepSel && prev) {
      const i = rows.findIndex((r) => r.url === prev.url && r.kind === prev.kind);
      sel = i >= 0 ? i : 0;
    } else sel = 0;
    render();
  }

  // ---------- Searching ----------

  async function update() {
    const id = ++seq;
    const q = typed;
    remote = [];
    const suggestions = q.trim() ? send({ type: 'suggest', q }) : null;
    const result = await send({ type: 'query', q });
    if (id !== seq || !Array.isArray(result)) return;
    local = result;
    show(false);
    autofill();
    if (!suggestions) return;
    const more = await suggestions;
    if (id !== seq || !Array.isArray(more) || !more.length) return;
    remote = more;
    // Suggestions arrive a moment later: add them below without moving your selection.
    show(true);
  }

  // Complete the top row inline, selected, so typing on replaces it and Backspace removes it.
  function autofill() {
    const top = rows[0];
    if (!allowFill || sel !== 0 || !top?.complete || input.value !== typed) return;
    if (input.selectionStart !== typed.length || input.selectionEnd !== typed.length) return;
    if (!top.complete.toLowerCase().startsWith(typed.toLowerCase())) return;
    input.value = typed + top.complete.slice(typed.length);
    input.setSelectionRange(typed.length, input.value.length, 'backward');
  }

  // Show the selected row's text in the field, like Google does as you move through suggestions.
  function fillField() {
    const r = rows[sel];
    if (!r) return;
    if (sel === 0 && r.complete && rowsFor === typed) {
      input.value = typed + r.complete.slice(typed.length);
      input.setSelectionRange(typed.length, input.value.length, 'backward');
      return;
    }
    input.value = r.fill ?? typed;
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function move(d) {
    if (!rows.length) return;
    sel = (sel + d + rows.length) % rows.length;
    markSelected();
    fillField();
  }

  function onInput(e) {
    typed = input.value;
    allowFill = !(e.inputType || '').startsWith('delete') && !e.isComposing;
    update();
  }

  // ---------- Opening ----------

  function modeFor(e) {
    if (e.shiftKey) return 'here';
    if (e.ctrlKey || e.metaKey || e.button === 1) return 'background';
    return 'new';
  }

  function go(e, row) {
    if (row && rowsFor === typed && !e.altKey) {
      // The calculator's answer: copy it.
      if (row.kind === 'answer' && row.copy) {
        copyText(row.copy);
        return close(false, `Copied ${row.copy}`);
      }
      if (row.kind === 'command') return runCommand(row);
    }
    const mode = modeFor(e);
    // Alt+Enter: search Google for exactly what you typed, whatever is selected.
    if (e.altKey && typed.trim()) send({ type: 'open', url: 'https://www.google.com/search?q=' + encodeURIComponent(typed.trim()).replace(/%20/g, '+'), mode });
    else if (row && rowsFor === typed) send({ type: 'open', row, mode });
    // Enter pressed before the results for the last letters came back: let argon rank what you typed.
    else if (typed.trim()) send({ type: 'go', q: typed, mode });
    else return;
    close(mode === 'here' || mode === 'new');
  }

  // ---------- Commands ----------

  // Copying and picture-in-picture happen right here in the page: they need the keypress that asked for them.
  // Everything else is done by argon's background.
  function runCommand(row) {
    if (row.id === 'copy' || row.id === 'copy-md') {
      copyText(row.id === 'copy' ? row.url : `[${(row.pageTitle || row.url).replace(/([[\]])/g, '\\$1')}](${row.url})`);
      return close(false, row.id === 'copy' ? 'Link copied' : 'Markdown link copied');
    }
    if (row.id === 'pip') {
      close(false);
      if (document.pictureInPictureElement) return void document.exitPictureInPicture().catch(() => {});
      // The biggest video on the page, playing ones first.
      const videos = [...document.querySelectorAll('video')].sort((a, b) =>
        (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      const v = videos[0];
      if (v) {
        v.disablePictureInPicture = false;
        v.requestPictureInPicture().catch(() => {});
      }
      return;
    }
    send({ type: 'open', row });
    close(row.id !== 'close');
  }

  function copyText(text) {
    navigator.clipboard?.writeText(text).catch(fallbackCopy) ?? fallbackCopy();
    function fallbackCopy() {
      // Pages without clipboard access (plain http): the old way, through a hidden text box.
      const box = document.createElement('textarea');
      box.value = text;
      box.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      (document.body || document.documentElement).append(box);
      box.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ }
      box.remove();
    }
  }

  // Shift+Delete: forget the selected past search or page, like the address bar.
  async function forget() {
    const row = rows[sel];
    const at = sel;
    input.value = typed; // drop an autofill or a suggestion you Tabbed to
    allowFill = false;
    await send({ type: 'remove', row });
    await update();
    sel = Math.min(at, rows.length - 1);
    markSelected(false);
  }

  // ---------- Opening before the background is awake ----------

  // The browser swallows your shortcut's key press, but letting go of the key still reaches the page. A key let
  // go that the page never saw go down, while its modifier was held, means the shortcut was just used: open right
  // away instead of waiting for argon's background worker, which may first have to wake up.
  let shortcut = null;      // e.g. { mod: 'Control', code: 'KeyT' }
  let modDownAt = -1e9;     // when the shortcut's modifier last went down
  let armed = false;        // the modifier went down and the shortcut's key hasn't been seen
  let pressed = new Set();  // keys the page saw go down since then
  let early = [];           // letters typed after the shortcut, before the palette appeared
  let lastToggle = -1e9;
  let selfOpened = -1e9;

  const MODS = { Ctrl: 'Control', MacCtrl: 'Control', Alt: 'Alt', Shift: 'Shift', Command: 'Meta' };
  function parseShortcut(s) {
    const parts = (s || '').split('+');
    const key = parts[parts.length - 1];
    const code = /^[A-Z]$/.test(key) ? 'Key' + key : /^[0-9]$/.test(key) ? 'Digit' + key
      : { Comma: 'Comma', Period: 'Period', Space: 'Space' }[key];
    return parts.length > 1 && MODS[parts[0]] && code ? { mod: MODS[parts[0]], code } : null;
  }

  function watchShortcut(e) {
    if (!shortcut || !e.isTrusted) return;
    const now = performance.now();
    if (e.type === 'keydown') {
      if (e.key === shortcut.mod) {
        if (!e.repeat) { modDownAt = now; armed = true; pressed = new Set(); early = []; }
      } else {
        pressed.add(e.code);
        // Letters typed straight after the shortcut (the modifier already let go) are meant for the palette.
        if (!isOpen && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && now - modDownAt < 1500) early.push(e.key);
      }
    } else if (e.type === 'keyup' && e.code === shortcut.code && armed && !pressed.has(e.code) && now - modDownAt < 1500) {
      armed = false;
      if (!isOpen && now - lastToggle > 700 && document.hasFocus()) {
        selfOpened = now;
        lastToggle = now;
        open();
      }
    }
  }

  // ---------- Keyboard ----------

  // Registered on the window before the page's own listeners (argon loads as the page starts), so pages with
  // single-key shortcuts (YouTube, GitHub, Gmail) never see what you type into the palette.
  function onKey(e) {
    if (!IN_POPUP) watchShortcut(e);
    if (!isOpen) return;
    // Esc always closes, even if the page managed to pull focus away from the palette.
    if (e.key === 'Escape' && e.type === 'keydown' && !e.isComposing) {
      e.preventDefault();
      if (!IN_POPUP) e.stopImmediatePropagation();
      return close(false);
    }
    if (!IN_POPUP && !e.composedPath().includes(host)) return;
    if (e.type === 'keydown') handleKey(e);
    if (!IN_POPUP) e.stopImmediatePropagation();
  }

  function handleKey(e) {
    if (e.isComposing) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); return close(false); }
    if (k === 'Tab') { e.preventDefault(); return move(e.shiftKey ? -1 : 1); }
    if (k === 'ArrowDown') { e.preventDefault(); return move(1); }
    if (k === 'ArrowUp') { e.preventDefault(); return move(-1); }
    if (k === 'Enter') { e.preventDefault(); return go(e, rows[sel]); }
    if (k === 'Delete' && e.shiftKey && rows[sel]?.removable) { e.preventDefault(); return forget(); }
    // Right arrow or End at the end of an autofill accepts it.
    if ((k === 'ArrowRight' || k === 'End') && input.selectionEnd === input.value.length && input.selectionStart < input.selectionEnd) {
      typed = input.value;
      allowFill = false;
      update();
    }
  }

  // ---------- Mouse ----------

  let hoverIdx = -1;
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest?.('.row');
    const i = li ? [...list.children].indexOf(li) : -1;
    if (i === hoverIdx) return;
    list.children[hoverIdx]?.classList.remove('hover');
    hoverIdx = i;
    if (i >= 0 && i !== sel) li.classList.add('hover');
  });
  list.addEventListener('mouseleave', () => { list.children[hoverIdx]?.classList.remove('hover'); hoverIdx = -1; });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the field
  list.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());
  list.addEventListener('mouseup', (e) => {
    if (e.button > 1) return;
    const li = e.target.closest?.('.row');
    const i = li ? [...list.children].indexOf(li) : -1;
    if (i >= 0) go(e, rows[i]);
  });
  backdrop?.addEventListener('mousedown', (e) => { e.preventDefault(); close(false); });
  // Scrolling over the backdrop shouldn't scroll the page underneath.
  backdrop?.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

  input.addEventListener('input', onInput);
  // Some pages pull focus back to themselves; keep it in the palette while it's open.
  input.addEventListener('blur', () => {
    if (isOpen && !IN_POPUP && document.hasFocus()) requestAnimationFrame(() => isOpen && input.focus({ preventScroll: true }));
  });

  // ---------- Open / close ----------

  function attach() {
    if (!host.isConnected) (document.documentElement || document).appendChild(host);
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    hide(); // a note from the last copy goes away
    if (!IN_POPUP) {
      lastFocus = document.activeElement;
      attach();
      host.style.setProperty('display', 'block', 'important');
      // The top layer puts the palette above everything, even fullscreen videos and the page's own dialogs.
      try { host.popover = 'manual'; host.showPopover(); } catch { /* still on top via z-index */ }
    }
    // Anything you already typed after the shortcut carries over into the field.
    const seed = performance.now() - modDownAt < 1500 ? early.join('') : '';
    early = [];
    typed = seed;
    input.value = seed;
    allowFill = true;
    local = [];
    remote = [];
    rows = [];
    list.replaceChildren();
    input.focus({ preventScroll: true });
    update();
  }

  // `note`: a short message (like "Link copied") left on screen for a moment after the palette closes.
  function close(navigating, note) {
    if (!isOpen) return;
    isOpen = false;
    seq++;
    if (IN_POPUP) return window.close();
    if (note) {
      root.classList.add('toasting');
      toastEl.textContent = note;
      host.style.setProperty('pointer-events', 'none', 'important'); // the page stays clickable underneath
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hide, 1400);
    } else hide();
    // Put focus back where you were, unless you're leaving for another page.
    if (!navigating && lastFocus?.isConnected && lastFocus !== document.body) {
      try { lastFocus.focus({ preventScroll: true }); } catch { /* fine */ }
    }
    lastFocus = null;
  }

  function hide() {
    clearTimeout(toastTimer);
    root.classList.remove('toasting');
    host.style.setProperty('pointer-events', 'auto', 'important');
    if (isOpen) return;
    try { host.hidePopover(); } catch { /* not a popover */ }
    host.style.setProperty('display', 'none', 'important');
  }

  // Returns false when the page doesn't have keyboard focus (you pressed Ctrl+T in the address bar): no page can
  // take focus from the browser's toolbar, so argon drops the palette from the toolbar icon instead.
  function toggle() {
    lastToggle = performance.now();
    if (isOpen) { close(false); return true; }
    if (!IN_POPUP && !document.hasFocus()) return false;
    open();
    return true;
  }

  // ---------- Wiring ----------

  const target = IN_POPUP ? document : window;
  for (const type of ['keydown', 'keyup', 'keypress']) target.addEventListener(type, onKey, true);

  function onMessage(msg, _sender, reply) {
    if (msg?.type !== 'toggle') return;
    // Already opened when the shortcut's key was let go: this is the same Ctrl+T arriving late.
    if (performance.now() - selfOpened < 1000) {
      selfOpened = -1e9;
      return void reply('ok');
    }
    reply(toggle() ? 'ok' : 'nofocus');
  }
  if (!IN_POPUP) chrome.runtime.onMessage.addListener(onMessage);

  // Which shortcut to watch for (argon's background keeps it in storage).
  function onStorage(changes, area) {
    if (area === 'local' && changes.shortcut) shortcut = parseShortcut(changes.shortcut.newValue);
  }
  if (!IN_POPUP) {
    try {
      chrome.storage.local.get('shortcut', (r) => { void chrome.runtime.lastError; shortcut = parseShortcut(r?.shortcut); });
      chrome.storage.onChanged.addListener(onStorage);
    } catch { /* disconnected */ }
  }

  // Keep argon's background awake while you're using this tab, so Ctrl+T never waits on it starting up.
  // Only the tab you're looking at does this: one tiny message every 20 seconds.
  function ping() {
    if (document.visibilityState === 'visible' && document.hasFocus()) send({ type: 'ping' });
  }
  const pinger = IN_POPUP ? 0 : setInterval(ping, 20e3);
  if (!IN_POPUP) {
    addEventListener('focus', ping);
    ping();
  }

  // Going back to a page from the back/forward cache shouldn't bring the palette back with it.
  addEventListener('pagehide', () => close(true));

  function destroy() {
    close(true);
    for (const type of ['keydown', 'keyup', 'keypress']) target.removeEventListener(type, onKey, true);
    clearInterval(pinger);
    removeEventListener('focus', ping);
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorage);
    } catch { /* disconnected */ }
    host.remove();
  }

  window.__argon = { alive, destroy, toggle };
  document.querySelectorAll?.('argon-palette').forEach((el) => el !== host && el.remove());

  if (IN_POPUP) {
    document.body.append(host);
    host.style.setProperty('position', 'static', 'important');
    host.style.setProperty('width', 'auto', 'important');
    host.style.setProperty('height', 'auto', 'important');
    host.style.setProperty('display', 'block', 'important');
    // A second Ctrl+T closes the popup.
    chrome.runtime.connect({ name: 'popup' }).onMessage.addListener((m) => m.type === 'close' && window.close());
    open();
    return true;
  }
  // Loaded with the page (as it starts loading): wait for Ctrl+T. Injected later by Ctrl+T itself, on a page
  // that was open before argon was installed: open right away, in the same step.
  return document.readyState === 'loading' ? true : toggle();
})();

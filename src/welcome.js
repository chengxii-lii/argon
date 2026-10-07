// Shows whether Ctrl+T (and, optionally, Ctrl+W) are bound to argon yet, and keeps checking while you set them.
const isKey = (shortcut, letter) => new RegExp(`^(Ctrl|Command|⌘)\\+${letter}$`, 'i').test((shortcut || '').replace(/\s/g, ''));

function show(id, ok, text, optional = false) {
  const el = document.getElementById(id);
  el.classList.toggle('ok', ok);
  el.classList.toggle('optional', optional);
  document.getElementById(`${id}-text`).textContent = text;
}

async function check() {
  const commands = await chrome.commands.getAll();
  const open = commands.find((c) => c.name === 'open-palette')?.shortcut || '';
  const close = commands.find((c) => c.name === 'close-tab')?.shortcut || '';
  chrome.storage.local.set({ shortcut: open }); // pages watch for this shortcut (see palette.js)

  show('status', isKey(open, 'T'),
    isKey(open, 'T') ? 'Ctrl+T opens argon.'
      : open ? `Right now argon opens with ${open}. Set it to Ctrl+T.` : 'No shortcut to open argon yet.');
  show('status-w', isKey(close, 'W'),
    isKey(close, 'W') ? 'Ctrl+W never closes your last tab.'
      : close ? `Closing tabs safely is on ${close}.` : 'Ctrl+W is the browser’s own (optional).', true);
}

document.getElementById('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
addEventListener('focus', check);
document.addEventListener('visibilitychange', () => !document.hidden && check());
check();

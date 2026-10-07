// Shows whether Ctrl+T is bound to argon yet, and keeps checking while you set it.
const status = document.getElementById('status');
const text = document.getElementById('status-text');

async function check() {
  const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'open-palette');
  const key = cmd?.shortcut || '';
  chrome.storage.local.set({ shortcut: key }); // pages watch for this shortcut (see palette.js)
  const ok = /^(Ctrl|Command|⌘)\+T$/i.test(key.replace(/\s/g, ''));
  status.classList.toggle('ok', ok);
  text.textContent = ok ? 'Ctrl+T opens argon. You’re all set.'
    : key ? `Right now argon opens with ${key}. Set it to Ctrl+T.`
    : 'No shortcut set yet.';
}

document.getElementById('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
addEventListener('focus', check);
document.addEventListener('visibilitychange', () => !document.hidden && check());
check();

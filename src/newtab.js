// argon's new tab: "Press Ctrl T to search", with your real shortcut. It's also where you land when you close
// your last tab with Ctrl+W, so Helium never quits by accident.
(async () => {
  const line = document.getElementById('rest');
  const key = (await chrome.commands.getAll()).find((c) => c.name === 'open-palette')?.shortcut;
  if (!key) {
    line.textContent = 'Click argon’s icon to search';
    return;
  }
  line.append('Press');
  for (const k of key.split(/\+(?!$)/)) line.append(Object.assign(document.createElement('kbd'), { textContent: k }));
  line.append('to search');
})();

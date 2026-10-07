# Changelog

## v1.5

- **Command mode.** Type `>` or `-` for tab and window commands: pin, duplicate, mute, reload, close, copy link (plain or Markdown), picture-in-picture, move to new window, reopen closed tab, close others / to the right, unload inactive tabs, zoom, incognito, and Helium's settings pages. Typing a command's name works without the `>` too.
- **Calculator.** Math like `(3+4)^2/7` shows the answer first; Enter copies it.
- **New tab.** argon replaces the new tab page with the README's gradient and "Press Ctrl+T to search".
- **Your last tab stays.** Bind argon's "Close tab" to Ctrl+W and Ctrl+W never closes a window: a window's last page becomes argon's new tab, and that new tab stays put.
- **No more toolbar drop-down.** Ctrl+T on a blank tab swaps in argon's new tab with the palette open. On pages no extension can draw on, it opens argon's new tab next to it, palette open; in the address bar, it leaves you there.
- **Repo.** 56 checks; new art for commands and the new tab.

## v1.4

- **Open tabs.** Tabs you have open show up first and switch instead of opening twice, marked "Tab". With nothing typed, your last few tabs lead the list. Autofilling a site you have open switches to it.
- **Shift+Delete** forgets the selected past search or page.
- **Exact addresses win.** Typing a full address you've been to goes there, not to a longer page that starts the same.
- **Never waiting.** Ctrl+T opens the palette the moment the key is released, without a round trip to the background worker, and the tab you're using keeps that worker awake. Letters typed before the palette appears land in the field.
- **Repo.** `npm test` runs 36 checks in a real headless browser; `npm run art` re-renders the README art (now with a demo GIF); a weekly workflow keeps the bang list fresh.

## v1.3

- Pages that differ only by their `?query` (tracking links, bot checks) show up once, as the plainer address.
- A README with ShaderGradient art.

## v1.2

- At most seven entries, and the palette is exactly that tall.

## v1.1

- Opens and closes instantly: no animations.
- Esc closes even if the page pulled focus away.
- Ctrl+T from the address bar drops the palette from the toolbar, because pages can't take focus from there.
- Dead center, at a fixed height.
- Helium's logo blue as the accent.

## v1.0

- Ctrl+T opens a command palette on the current page.
- History first (past searches and pages, with inline autofill), then Google search, suggestions and calculator answers.
- Tab and Shift+Tab cycle through suggestions.
- Helium's native !bangs, leading or trailing, from Helium's own list.

# argon

Ctrl+T opens a fast command palette on the page you're on, instead of a new tab. Made for [Helium](https://helium.computer), works in any Chromium browser.

- **History first.** Past searches and pages you've visited, with inline autofill (`you` → `youtube.com`, `how to ce` → `how to center a div`).
- **Then Google.** Searching Google for exactly what you typed is always there, followed by Google's suggestions and calculator answers.
- **Tab** and **Shift+Tab** cycle through suggestions, filling the field as you go.
- **Helium's !bangs**: all of them, leading or trailing (`!yt cats`, `cats !w`), from the same list Helium's address bar uses, refreshed every few days.

## Install

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick this folder.
2. Open `chrome://extensions/shortcuts` and set argon's **Open the palette** to **Ctrl+T**. If another extension already uses it, clear that one first.

## Keys

| Key | Does |
| --- | --- |
| Tab / Shift+Tab, ↑ / ↓ | Move through suggestions |
| Enter | Open in a new tab (a blank tab is reused) |
| Shift+Enter | Open in this tab |
| Ctrl+Enter | Open in a background tab |
| Alt+Enter | Search Google for exactly what you typed |
| → | Accept the autofill |
| Esc | Close |

On pages no extension can draw on (browser settings, the Web Store, the new tab page), the palette drops down from the toolbar icon instead.

## Development

- `node scripts/build-bangs.js` refreshes the bundled `data/bangs.json` from Helium's list.
- `node scripts/make-icons.js` redraws the icons.

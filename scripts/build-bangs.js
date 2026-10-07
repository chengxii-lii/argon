// Builds data/bangs.json from Helium's own bang list, so argon resolves !bangs exactly like Helium's address bar.
// Usage: node scripts/build-bangs.js            (downloads the latest list)
//        node scripts/build-bangs.js file.jsonc (uses a saved copy)
//
// Output: { "s": [[name, template], ...], "t": { trigger: siteIndex, ... } }
// Sites keep Helium's order, which is roughly by popularity, so a lower index ranks first in suggestions.
const fs = require('fs');
const path = require('path');

const SOURCE = 'https://services.helium.imput.net/bangs.json';
const OUT = path.join(__dirname, '..', 'data', 'bangs.json');

// Helium's list is JSON with // comments and trailing commas (parsed with JSON_ALLOW_COMMENTS | TRAILING_COMMAS).
function parseLenient(text) {
  return JSON.parse(text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').replace(/,(\s*[\]}])/g, '$1'));
}

function compact(list) {
  const sites = [];
  const triggers = {};
  for (const b of list) {
    if (!b || typeof b.s !== 'string' || typeof b.u !== 'string' || !Array.isArray(b.ts) || !b.ts.length) continue;
    try {
      if (!/^https?:$/.test(new URL(b.u.replace('{searchTerms}', 'x')).protocol)) continue;
    } catch { continue; }
    const index = sites.push([b.s, b.u]) - 1;
    for (const t of b.ts) {
      const key = String(t).toLowerCase();
      if (key && !/\s/.test(key) && !(key in triggers)) triggers[key] = index;
    }
  }
  return { s: sites, t: triggers };
}

(async () => {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, 'utf8') : await (await fetch(SOURCE)).text();
  const data = compact(parseLenient(text));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`${data.s.length} sites, ${Object.keys(data.t).length} triggers -> ${OUT} (${fs.statSync(OUT).size} bytes)`);
})();

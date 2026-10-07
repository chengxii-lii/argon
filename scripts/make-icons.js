// Renders argon's icon (a teal rounded square with a white search glyph) to icons/*.png. No dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Signed distances in a 0..1 canvas.
const sdRoundRect = (x, y, half, r) => {
  const qx = Math.abs(x - 0.5) - half + r, qy = Math.abs(y - 0.5) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdSegment = (px, py, ax, ay, bx, by) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
};

function render(size) {
  const out = Buffer.alloc(size * size * 4);
  const ss = 4; // supersampling
  const top = [52, 196, 180], bottom = [20, 112, 103];
  const stroke = size <= 16 ? 0.105 : size <= 32 ? 0.09 : 0.08;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const x = (px + (sx + 0.5) / ss) / size, y = (py + (sy + 0.5) / ss) / size;
        if (sdRoundRect(x, y, 0.47, 0.22) > 0) continue;
        const t = y;
        let c = top.map((v, i) => v + (bottom[i] - v) * t);
        // Glyph: a ring and a handle, white.
        const ring = Math.abs(Math.hypot(x - 0.45, y - 0.45) - 0.17) - stroke / 2;
        const handle = sdSegment(x, y, 0.575, 0.575, 0.72, 0.72) - stroke / 2;
        if (Math.min(ring, handle) <= 0) c = [255, 255, 255];
        r += c[0]; g += c[1]; b += c[2]; a++;
      }
      const i = (py * size + px) * 4;
      if (a) { out[i] = r / a; out[i + 1] = g / a; out[i + 2] = b / a; }
      out[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, out);
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(dir, `icon${s}.png`), render(s));
console.log('icons written to', dir);

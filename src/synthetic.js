'use strict';
/** Synthetic radiograph generator (ported from the browser version). Returns a grayscale Uint8Array. */

const PRESETS = ['chest', 'hand', 'spine', 'dental'];

function generateSyntheticXray(type, width = 512, height = 512) {
  if (!PRESETS.includes(type)) throw new Error(`Unknown preset: ${type}`);
  const out = new Uint8Array(width * height);
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 15;
      const nx = (x - width / 2) / (width / 2);
      const ny = (y - height / 2) / (height / 2);

      if (type === 'chest') {
        const rib = Math.sin(ny * 18 + Math.abs(nx) * 3) * 45;
        const insideLungs = nx * nx * 1.8 + ny * ny * 1.2 < 0.75;
        const hd = dist(x, y, width * 0.42, height * 0.55);
        const heart = hd < 80 ? (1 - hd / 80) * 110 : 0;
        const spine = Math.abs(nx) < 0.08 ? 130 : 0;
        val = insideLungs ? 35 + rib * 0.5 + heart * 0.4 : 140 + rib + spine;
        if (y > height * 0.2 && y < height * 0.28 && Math.abs(nx) > 0.15) val += 70; // clavicles
      } else if (type === 'hand') {
        let bone = 0;
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.15;
          const rx = nx * Math.cos(a) - ny * Math.sin(a);
          const ry = nx * Math.sin(a) + ny * Math.cos(a);
          if (Math.abs(rx - i * 0.18) < 0.05 && ry < 0.45 && ry > -0.7) bone = 180 + Math.cos(ry * 30) * 30;
        }
        if (dist(x, y, width * 0.5, height * 0.75) < 65) bone = 160 + Math.random() * 30; // carpals
        const outline = dist(x, y, width * 0.5, height * 0.3) < 180;
        val = bone > 0 ? bone : outline ? 45 : 10;
      } else if (type === 'spine') {
        const vy = y % 70;
        const disc = vy > 58 || vy < 8;
        val = Math.abs(nx) < 0.22 ? (disc ? 50 : 180 + Math.sin(nx * 20) * 20) : 30 + (1 - Math.abs(nx)) * 25;
      } else if (type === 'dental') {
        const tx = x % 90;
        const gap = tx > 75;
        const crown = y > height * 0.3 && y < height * 0.6;
        const root = y >= height * 0.6 && y < height * 0.85;
        if (!gap && (crown || root)) {
          val = crown ? 220 : 160;
          if (Math.abs(tx - 40) < 10 && crown) val -= 80; // pulp
        } else val = y >= height * 0.55 ? 110 : 20;
      }

      val += (Math.random() - 0.5) * 16; // quantum mottle
      out[y * width + x] = val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
    }
  }
  return out;
}

module.exports = { PRESETS, generateSyntheticXray };

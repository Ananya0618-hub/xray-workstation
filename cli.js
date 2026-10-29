#!/usr/bin/env node
'use strict';
/**
 * Batch / headless enhancement.
 *   node cli.js chest.png -m clahe --clip 3 --grid 8 -o out.png
 *   node cli.js --preset hand -m gamma --gamma 0.5 -o hand_gamma.png
 */
const fs = require('fs/promises');
const path = require('path');
const { parseArgs } = require('util');
const { enhance, computeMetrics, METHODS } = require('./src/processing');
const { PRESETS, generateSyntheticXray } = require('./src/synthetic');
const { decodeToGray, encodePng } = require('./src/imageio');

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    method: { type: 'string', short: 'm', default: 'clahe' },
    preset: { type: 'string', short: 'p' },
    clip:   { type: 'string', default: '3' },
    grid:   { type: 'string', default: '8' },
    gamma:  { type: 'string', default: '0.6' },
    min:    { type: 'string', default: '30' },
    max:    { type: 'string', default: '225' },
    out:    { type: 'string', short: 'o' },
    help:   { type: 'boolean', short: 'h' },
  },
});

function usage(code = 0) {
  console.log(`Usage: node cli.js <input-image> | --preset <${PRESETS.join('|')}>
  -m, --method  ${METHODS.join('|')} (default clahe)
      --clip    CLAHE clip limit 1-10      --grid  4|8|16
      --gamma   0.1-3.0                    --min/--max  stretch cutoffs
  -o, --out     output PNG path`);
  process.exit(code);
}

(async () => {
  if (o.help || (!positionals[0] && !o.preset)) usage(o.help ? 0 : 1);
  if (!METHODS.includes(o.method)) { console.error(`Unknown method: ${o.method}`); usage(1); }

  let img;
  if (o.preset) {
    img = { pixels: generateSyntheticXray(o.preset, 512, 512), width: 512, height: 512 };
  } else {
    img = await decodeToGray(await fs.readFile(positionals[0]));
  }

  const { pixels, timeMs, params } = enhance(img.pixels, img.width, img.height, {
    method: o.method, clipLimit: o.clip, gridSize: o.grid, gamma: o.gamma, minCutoff: o.min, maxCutoff: o.max,
  });
  const m = computeMetrics(img.pixels, pixels);

  const base = o.preset || path.parse(positionals[0]).name;
  const out = o.out || `${base}_${params.method}.png`;
  await fs.writeFile(out, await encodePng(pixels, img.width, img.height, 6));

  console.log(JSON.stringify({
    output: out, size: `${img.width}x${img.height}`, params,
    timeMs: +timeMs.toFixed(2), contrast: +m.contrast.toFixed(2), entropy: +m.entropy.toFixed(3),
    psnr: m.psnr === null ? 'INF' : +m.psnr.toFixed(2),
  }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });

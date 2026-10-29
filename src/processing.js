'use strict';
/**
 * Spatial-domain radiograph enhancement.
 * All functions operate on single-channel 8-bit grayscale buffers (Uint8Array, length = w*h).
 */

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function applyLUT(src, lut) {
  const dst = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) dst[i] = lut[src[i]];
  return dst;
}

// 1. CLAHE — per-tile clipped histograms + bilinear interpolation between tile CDFs
function clahe(src, width, height, clipLimit = 3.0, gridTiles = 8) {
  const numBins = 256;
  const tileW = Math.floor(width / gridTiles);
  const tileH = Math.floor(height / gridTiles);
  if (tileW < 1 || tileH < 1) throw new Error(`Image ${width}x${height} too small for ${gridTiles}x${gridTiles} grid`);

  const cdfs = Array.from({ length: gridTiles }, () => new Array(gridTiles));

  for (let gy = 0; gy < gridTiles; gy++) {
    for (let gx = 0; gx < gridTiles; gx++) {
      const hist = new Int32Array(numBins);
      const x0 = gx * tileW, y0 = gy * tileH;
      const x1 = gx === gridTiles - 1 ? width : x0 + tileW;
      const y1 = gy === gridTiles - 1 ? height : y0 + tileH;
      const n = (x1 - x0) * (y1 - y0);

      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) hist[src[row + x]]++;
      }

      const limit = Math.max(1, Math.floor((clipLimit * n) / numBins));
      let excess = 0;
      for (let i = 0; i < numBins; i++) {
        if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; }
      }
      const bonus = Math.floor(excess / numBins);
      const rem = excess % numBins;
      for (let i = 0; i < numBins; i++) hist[i] += bonus + (i < rem ? 1 : 0);

      const cdf = new Float32Array(numBins);
      let sum = 0;
      for (let i = 0; i < numBins; i++) { sum += hist[i]; cdf[i] = (sum / n) * 255; }
      cdfs[gy][gx] = cdf;
    }
  }

  const dst = new Uint8Array(src.length);
  const last = gridTiles - 1;
  for (let y = 0; y < height; y++) {
    const gyf = (y - tileH / 2) / tileH;
    const gy0 = Math.max(0, Math.min(last, Math.floor(gyf)));
    const gy1 = Math.min(last, gy0 + 1);
    const fy = Math.max(0, Math.min(1, gyf - gy0));
    for (let x = 0; x < width; x++) {
      const gxf = (x - tileW / 2) / tileW;
      const gx0 = Math.max(0, Math.min(last, Math.floor(gxf)));
      const gx1 = Math.min(last, gx0 + 1);
      const fx = Math.max(0, Math.min(1, gxf - gx0));
      const idx = y * width + x;
      const v = src[idx];
      const out =
        (1 - fx) * (1 - fy) * cdfs[gy0][gx0][v] +
        fx * (1 - fy) * cdfs[gy0][gx1][v] +
        (1 - fx) * fy * cdfs[gy1][gx0][v] +
        fx * fy * cdfs[gy1][gx1][v];
      dst[idx] = clampByte(Math.round(out));
    }
  }
  return dst;
}

// 2. Global histogram equalization
function histogramEqualization(src) {
  const hist = computeHistogram(src);
  const lut = new Uint8Array(256);
  let sum = 0;
  for (let i = 0; i < 256; i++) { sum += hist[i]; lut[i] = Math.round((sum / src.length) * 255); }
  return applyLUT(src, lut);
}

// 3. Power-law / gamma
function gammaCorrection(src, gamma = 0.6) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = clampByte(Math.round(255 * Math.pow(i / 255, gamma)));
  return applyLUT(src, lut);
}

// 4. Log transform
function logTransform(src) {
  const c = 255 / Math.log(256);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(c * Math.log(1 + i));
  return applyLUT(src, lut);
}

// 5. Linear contrast stretch
function linearStretch(src, minIn = 30, maxIn = 225) {
  if (maxIn <= minIn) maxIn = minIn + 1;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = i <= minIn ? 0 : i >= maxIn ? 255 : Math.round(((i - minIn) / (maxIn - minIn)) * 255);
  }
  return applyLUT(src, lut);
}

// 6. Negative
function negative(src) {
  const dst = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) dst[i] = 255 - src[i];
  return dst;
}

function computeHistogram(px) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < px.length; i++) hist[px[i]]++;
  return hist;
}

function computeMetrics(orig, proc) {
  const N = proc.length;
  const hist = new Array(256).fill(0);
  let sum = 0, mse = 0;
  for (let i = 0; i < N; i++) {
    const v = proc[i];
    sum += v; hist[v]++;
    const d = v - orig[i]; mse += d * d;
  }
  const mean = sum / N;
  let variance = 0;
  for (let i = 0; i < N; i++) { const d = proc[i] - mean; variance += d * d; }
  let entropy = 0;
  for (let i = 0; i < 256; i++) if (hist[i]) { const p = hist[i] / N; entropy -= p * Math.log2(p); }
  mse /= N;
  return {
    contrast: Math.sqrt(variance / N),
    entropy,
    psnr: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse), // null => infinite
    histogram: hist,
  };
}

const METHODS = ['clahe', 'he', 'gamma', 'log', 'stretch', 'negative', 'original'];

const num = (v, def, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

/** Validate/clamp user params into a canonical shape. */
function normalizeParams(p = {}) {
  const method = METHODS.includes(p.method) ? p.method : 'clahe';
  const grid = [4, 8, 16].includes(Number(p.gridSize)) ? Number(p.gridSize) : 8;
  return {
    method,
    clipLimit: num(p.clipLimit, 3.0, 1.0, 10.0),
    gridSize: grid,
    gamma: num(p.gamma, 0.6, 0.1, 3.0),
    minCutoff: Math.round(num(p.minCutoff, 30, 0, 250)),
    maxCutoff: Math.round(num(p.maxCutoff, 225, 5, 255)),
  };
}

/** Run the selected method. Returns { pixels, timeMs, params }. */
function enhance(src, width, height, rawParams) {
  const params = normalizeParams(rawParams);
  const t0 = process.hrtime.bigint();
  let out;
  switch (params.method) {
    case 'clahe':    out = clahe(src, width, height, params.clipLimit, params.gridSize); break;
    case 'he':       out = histogramEqualization(src); break;
    case 'gamma':    out = gammaCorrection(src, params.gamma); break;
    case 'log':      out = logTransform(src); break;
    case 'stretch':  out = linearStretch(src, params.minCutoff, params.maxCutoff); break;
    case 'negative': out = negative(src); break;
    default:         out = new Uint8Array(src);
  }
  const timeMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return { pixels: out, timeMs, params };
}

module.exports = {
  METHODS, normalizeParams, enhance, computeHistogram, computeMetrics,
  clahe, histogramEqualization, gammaCorrection, logTransform, linearStretch, negative,
};

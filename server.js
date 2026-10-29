'use strict';
const path = require('path');
const express = require('express');
const multer = require('multer');

const { enhance, computeHistogram, computeMetrics, normalizeParams } = require('./src/processing');
const { PRESETS, generateSyntheticXray } = require('./src/synthetic');
const { decodeToGray, encodePng, MAX_DIM } = require('./src/imageio');
const { ImageStore } = require('./src/store');

const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);

const app = express();
const store = new ImageStore({ max: Number(process.env.STORE_MAX || 50) });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new HttpError(415, 'Only image files are supported')),
});

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const toDataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/chart', express.static(path.join(__dirname, 'node_modules/chart.js/dist')));
app.use('/vendor/lucide', express.static(path.join(__dirname, 'node_modules/lucide/dist/umd')));

async function registerImage(res, pixels, width, height, source) {
  const id = store.add({ pixels, width, height, source });
  const png = await encodePng(pixels, width, height);
  res.status(201).json({
    id, width, height, source,
    image: toDataUrl(png),
    histogram: computeHistogram(pixels),
  });
}

function getImage(id) {
  const entry = store.get(id);
  if (!entry) throw new HttpError(404, 'Image not found or expired — reload a preset or re-upload');
  return entry;
}

// --- API ---------------------------------------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true, maxDim: MAX_DIM }));

app.get('/api/presets', (_req, res) => res.json({ presets: PRESETS }));

app.post('/api/presets/:name', wrap(async (req, res) => {
  const { name } = req.params;
  if (!PRESETS.includes(name)) throw new HttpError(400, `Unknown preset "${name}"`);
  const size = 512;
  await registerImage(res, generateSyntheticXray(name, size, size), size, size, `preset:${name}`);
}));

app.post('/api/images', upload.single('image'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Missing "image" file field');
  let decoded;
  try { decoded = await decodeToGray(req.file.buffer); }
  catch { throw new HttpError(422, 'Could not decode image (raw DICOM is not supported — export to PNG/JPEG/TIFF first)'); }
  await registerImage(res, decoded.pixels, decoded.width, decoded.height, `upload:${req.file.originalname}`);
}));

app.post('/api/images/:id/process', wrap(async (req, res) => {
  const img = getImage(req.params.id);
  const { pixels, timeMs, params } = enhance(img.pixels, img.width, img.height, req.body);
  const { histogram, ...metrics } = computeMetrics(img.pixels, pixels);
  const png = await encodePng(pixels, img.width, img.height);
  res.json({ params, image: toDataUrl(png), histogram, metrics: { timeMs, ...metrics } });
}));

app.post('/api/images/:id/export', wrap(async (req, res) => {
  const img = getImage(req.params.id);
  const { pixels, params } = enhance(img.pixels, img.width, img.height, req.body);
  const png = await encodePng(pixels, img.width, img.height, 6);
  res.set({
    'Content-Type': 'image/png',
    'Content-Disposition': `attachment; filename="Enhanced_Radiograph_${params.method.toUpperCase()}_${Date.now()}.png"`,
  }).send(png);
}));

// --- Errors ------------------------------------------------------------

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

app.use((err, _req, res, _next) => {
  let status = err.status || 500;
  if (err instanceof multer.MulterError) status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

app.listen(PORT, () => console.log(`Radiology Vision Lab running on http://localhost:${PORT}`));

module.exports = { app, normalizeParams };

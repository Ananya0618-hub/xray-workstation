# Radiology Vision Lab — Node.js

X-ray contrast enhancement workstation. Processing (CLAHE, HE, gamma, log, linear stretch, negative), synthetic radiograph generation, histograms and metrics run server-side in Node; the browser only renders.

## Run

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # auto-restart on change
```

Requires Node 18.17+ (sharp 0.33).

| Env var         | Default | Purpose                                   |
|-----------------|---------|-------------------------------------------|
| `PORT`          | 3000    | HTTP port                                 |
| `MAX_IMAGE_DIM` | 2048    | Uploads are downscaled to fit this box    |
| `MAX_UPLOAD_MB` | 25      | Upload size limit                         |
| `STORE_MAX`     | 50      | Images kept in the in-memory LRU (1h TTL) |

## API

| Method | Path                       | Body                                   | Returns |
|--------|----------------------------|----------------------------------------|---------|
| GET    | `/api/presets`             | –                                      | preset names |
| POST   | `/api/presets/:name`       | –                                      | `{id, width, height, image, histogram}` |
| POST   | `/api/images`              | multipart field `image`                | same as above |
| POST   | `/api/images/:id/process`  | `{method, clipLimit, gridSize, gamma, minCutoff, maxCutoff}` | `{params, image, histogram, metrics}` |
| POST   | `/api/images/:id/export`   | same as process                        | PNG attachment |

`method`: `clahe | he | gamma | log | stretch | negative | original`. Params are clamped server-side (clip 1–10, grid 4/8/16, gamma 0.1–3, cutoffs 0–255). `metrics.psnr` is `null` when identical (∞).

## CLI

```bash
node cli.js xray.png -m clahe --clip 3 --grid 8 -o out.png
node cli.js --preset dental -m stretch --min 40 --max 210
```

## Layout

```
server.js          Express app + routes
cli.js             headless batch processing
src/processing.js  algorithms, metrics, param validation
src/synthetic.js   synthetic radiograph presets
src/imageio.js     sharp decode (→ 8-bit gray) / PNG encode
src/store.js       in-memory LRU image store
public/            index.html + app.js (UI only)
```

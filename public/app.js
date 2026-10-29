'use strict';
/* Client: UI + rendering only. All processing runs on the Node server (see server.js). */

const state = {
  imageId: null,
  method: 'clahe',
  clipLimit: 3.0,
  gridSize: 8,
  gamma: 0.6,
  minCutoff: 30,
  maxCutoff: 225,
  viewMode: 'split',
  splitRatio: 0.5,
  loupeActive: false,
  loupeSize: 160,
  loupeZoom: 2.5,
  width: 512,
  height: 512,
};

const $ = (id) => document.getElementById(id);
const canvasOriginal = $('canvasOriginal');
const canvasProcessed = $('canvasProcessed');
const canvasSideOriginal = $('canvasSideOriginal');
const canvasSideProcessed = $('canvasSideProcessed');
const loupe = $('loupe');
const loupeCanvas = $('loupeCanvas');
const loupeCtx = loupeCanvas.getContext('2d');
const statusEl = $('status');
let histogramChart = null;

// --- API helpers ---------------------------------------------------------
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res;
}

const currentParams = () => ({
  method: state.method,
  clipLimit: state.clipLimit,
  gridSize: state.gridSize,
  gamma: state.gamma,
  minCutoff: state.minCutoff,
  maxCutoff: state.maxCutoff,
});

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = `text-[11px] font-mono ${isError ? 'text-rose-400' : 'text-slate-500'}`;
}

function loadBitmap(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image from server'));
    img.src = dataUrl;
  });
}

function drawTo(canvases, img) {
  for (const c of canvases) c.getContext('2d').drawImage(img, 0, 0);
}

// --- Loading -------------------------------------------------------------
async function applyLoaded(payload) {
  state.imageId = payload.id;
  state.width = payload.width;
  state.height = payload.height;
  for (const c of [canvasOriginal, canvasProcessed, canvasSideOriginal, canvasSideProcessed]) {
    c.width = state.width;
    c.height = state.height;
  }
  drawTo([canvasOriginal, canvasSideOriginal], await loadBitmap(payload.image));
  histogramChart.data.datasets[0].data = payload.histogram;
  await runProcess();
}

async function loadPreset(name) {
  setStatus(`Generating ${name}…`);
  try {
    const res = await api(`/api/presets/${name}`, { method: 'POST' });
    await applyLoaded(await res.json());
  } catch (e) { setStatus(e.message, true); }
}

async function uploadFile(file) {
  setStatus(`Uploading ${file.name}…`);
  const fd = new FormData();
  fd.append('image', file);
  try {
    const res = await api('/api/images', { method: 'POST', body: fd });
    await applyLoaded(await res.json());
  } catch (e) { setStatus(e.message, true); }
}

// --- Processing (debounced, stale requests aborted) ----------------------
let inflight = null;
let debounceTimer = null;

function processImage() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runProcess, 50);
}

async function runProcess() {
  if (!state.imageId) return;
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  setStatus('Processing…');
  try {
    const res = await api(`/api/images/${state.imageId}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentParams()),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (ctrl.signal.aborted) return;
    drawTo([canvasProcessed, canvasSideProcessed], await loadBitmap(data.image));
    histogramChart.data.datasets[1].data = data.histogram;
    histogramChart.update();
    renderMetrics(data.metrics);
    updateSplitView();
    setStatus(`${state.width}×${state.height}`);
  } catch (e) {
    if (e.name !== 'AbortError') setStatus(e.message, true);
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}

function renderMetrics(m) {
  $('metricTime').innerText = `${m.timeMs.toFixed(1)} ms`;
  $('metricContrast').innerText = m.contrast.toFixed(2);
  $('metricEntropy').innerText = m.entropy.toFixed(2);
  $('metricPsnr').innerText = m.psnr === null ? 'INF' : `${m.psnr.toFixed(1)} dB`;
}

// --- Histogram -----------------------------------------------------------
function initHistogramChart() {
  histogramChart = new Chart($('histogramChart').getContext('2d'), {
    type: 'line',
    data: {
      labels: Array.from({ length: 256 }, (_, i) => i),
      datasets: [
        { label: 'Original', data: new Array(256).fill(0), borderColor: '#64748b',
          backgroundColor: 'rgba(100, 116, 139, 0.1)', borderWidth: 1, fill: true, pointRadius: 0 },
        { label: 'Enhanced', data: new Array(256).fill(0), borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14, 165, 233, 0.15)', borderWidth: 1.5, fill: true, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false, callbacks: { title: (items) => `Gray Level: ${items[0].label}` } },
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' },
             ticks: { color: '#64748b', font: { size: 10, family: 'JetBrains Mono' } } },
        y: { display: false, beginAtZero: true },
      },
    },
  });
}

// --- Split slider --------------------------------------------------------
function updateSplitView() {
  const pct = state.splitRatio * 100;
  $('processedWrapper').style.clipPath = `polygon(${pct}% 0, 100% 0, 100% 100%, ${pct}% 100%)`;
  $('splitDivider').style.left = `${pct}%`;
}

const splitContainer = $('splitViewContainer');
let isDraggingSplit = false;

function handleSplitMove(e) {
  if (!isDraggingSplit) return;
  const rect = splitContainer.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  state.splitRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  updateSplitView();
}

splitContainer.addEventListener('mousedown', (e) => { isDraggingSplit = true; handleSplitMove(e); });
window.addEventListener('mousemove', handleSplitMove);
window.addEventListener('mouseup', () => { isDraggingSplit = false; });
splitContainer.addEventListener('touchstart', (e) => { isDraggingSplit = true; handleSplitMove(e); }, { passive: true });
window.addEventListener('touchmove', handleSplitMove, { passive: true });
window.addEventListener('touchend', () => { isDraggingSplit = false; });

// --- ROI loupe -----------------------------------------------------------
const viewport = $('viewport');

viewport.addEventListener('mousemove', (e) => {
  if (!state.loupeActive || !state.imageId) return;
  // Sample whichever processed canvas is visible in the current view mode
  const source = state.viewMode === 'side' ? canvasSideProcessed : canvasProcessed;
  const rect = source.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (x < 0 || x > rect.width || y < 0 || y > rect.height) { loupe.style.display = 'none'; return; }

  const vp = viewport.getBoundingClientRect();
  loupe.style.display = 'block';
  loupe.style.left = `${e.clientX - vp.left - state.loupeSize / 2}px`;
  loupe.style.top = `${e.clientY - vp.top - state.loupeSize / 2}px`;

  const imgX = x * (state.width / rect.width);
  const imgY = y * (state.height / rect.height);
  const zw = state.loupeSize / state.loupeZoom;

  loupeCanvas.width = loupeCanvas.height = state.loupeSize;
  loupeCtx.imageSmoothingEnabled = false;
  loupeCtx.drawImage(source, imgX - zw / 2, imgY - zw / 2, zw, zw, 0, 0, state.loupeSize, state.loupeSize);
});

viewport.addEventListener('mouseleave', () => { loupe.style.display = 'none'; });

// --- UI wiring -----------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initHistogramChart();
  loadPreset('chest');

  const presetBtns = document.querySelectorAll('.preset-btn');
  const clearPresetSel = () => presetBtns.forEach((b) => b.classList.remove('active', 'border-cyan-500', 'bg-cyan-500/10'));
  presetBtns.forEach((btn) => btn.addEventListener('click', (e) => {
    clearPresetSel();
    const t = e.currentTarget;
    t.classList.add('active', 'border-cyan-500', 'bg-cyan-500/10');
    loadPreset(t.dataset.preset);
  }));

  const paramSections = { clahe: $('claheParams'), gamma: $('gammaParams'), stretch: $('stretchParams') };
  $('methodSelect').addEventListener('change', (e) => {
    state.method = e.target.value;
    $('activeMethodBadge').innerText = state.method.toUpperCase();
    for (const [k, el] of Object.entries(paramSections)) el.classList.toggle('hidden', k !== state.method);
    runProcess();
  });

  $('clipLimit').addEventListener('input', (e) => {
    state.clipLimit = parseFloat(e.target.value);
    $('clipVal').innerText = state.clipLimit.toFixed(1);
    processImage();
  });

  document.querySelectorAll('.grid-btn').forEach((btn) => btn.addEventListener('click', (e) => {
    document.querySelectorAll('.grid-btn').forEach((b) => {
      b.classList.remove('active', 'border-cyan-500', 'bg-cyan-500/20', 'text-cyan-300', 'font-semibold');
      b.classList.add('border-slate-700', 'bg-slate-800');
    });
    e.currentTarget.classList.remove('border-slate-700', 'bg-slate-800');
    e.currentTarget.classList.add('active', 'border-cyan-500', 'bg-cyan-500/20', 'text-cyan-300', 'font-semibold');
    state.gridSize = parseInt(e.currentTarget.dataset.grid, 10);
    $('gridVal').innerText = `${state.gridSize} x ${state.gridSize}`;
    runProcess();
  }));

  $('gammaSlider').addEventListener('input', (e) => {
    state.gamma = parseFloat(e.target.value);
    $('gammaVal').innerText = state.gamma.toFixed(2);
    processImage();
  });

  $('minCutoff').addEventListener('input', (e) => {
    state.minCutoff = parseInt(e.target.value, 10);
    $('minVal').innerText = state.minCutoff;
    processImage();
  });
  $('maxCutoff').addEventListener('input', (e) => {
    state.maxCutoff = parseInt(e.target.value, 10);
    $('maxVal').innerText = state.maxCutoff;
    processImage();
  });

  const ACTIVE = 'view-btn px-2.5 py-1 text-xs rounded-md bg-slate-800 text-cyan-400 font-medium transition flex items-center gap-1.5';
  const IDLE = 'view-btn px-2.5 py-1 text-xs rounded-md text-slate-400 hover:text-slate-200 transition flex items-center gap-1.5';
  const setView = (mode) => {
    state.viewMode = mode;
    $('viewSplit').className = mode === 'split' ? ACTIVE : IDLE;
    $('viewSide').className = mode === 'side' ? ACTIVE : IDLE;
    $('splitViewContainer').classList.toggle('hidden', mode !== 'split');
    $('sideViewContainer').classList.toggle('hidden', mode !== 'side');
  };
  $('viewSplit').addEventListener('click', () => setView('split'));
  $('viewSide').addEventListener('click', () => setView('side'));

  $('toggleLoupe').addEventListener('change', (e) => {
    state.loupeActive = e.target.checked;
    if (!state.loupeActive) loupe.style.display = 'none';
  });

  $('imageUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    clearPresetSel();
    uploadFile(file);
    e.target.value = ''; // allow re-uploading the same file
  });

  $('exportBtn').addEventListener('click', async () => {
    if (!state.imageId) return;
    try {
      const res = await api(`/api/images/${state.imageId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentParams()),
      });
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1]
        || `Enhanced_Radiograph_${state.method.toUpperCase()}.png`;
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setStatus(err.message, true); }
  });
});

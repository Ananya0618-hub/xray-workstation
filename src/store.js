'use strict';
const crypto = require('crypto');

/** In-memory LRU for loaded radiographs. Swap for Redis/disk for persistence or multi-instance deployments. */
class ImageStore {
  constructor({ max = 50, ttlMs = 60 * 60 * 1000 } = {}) {
    this.max = max; this.ttlMs = ttlMs; this.map = new Map();
  }
  add(entry) {
    const id = crypto.randomUUID();
    this.map.set(id, { ...entry, touched: Date.now() });
    this.#evict();
    return id;
  }
  get(id) {
    const e = this.map.get(id);
    if (!e) return null;
    if (Date.now() - e.touched > this.ttlMs) { this.map.delete(id); return null; }
    this.map.delete(id); e.touched = Date.now(); this.map.set(id, e); // bump LRU
    return e;
  }
  #evict() {
    const now = Date.now();
    for (const [id, e] of this.map) if (now - e.touched > this.ttlMs) this.map.delete(id);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

module.exports = { ImageStore };

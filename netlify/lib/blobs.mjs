// Netlify Blobs adapter for Store.
// Tries strong consistency (a claim is visible to the next request at once); if the runtime
// does not support it, falls back to the default (eventual) consistency instead of failing.
import { getStore } from '@netlify/blobs';

const enc = (k) => k.replace(/[^A-Za-z0-9/_.-]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
const dec = (k) => k.replace(/%([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

export class BlobKV {
  constructor(name = 'pray-offering') { this.name = name; this.mode = 'strong'; this.s = null; }
  store() {
    if (!this.s) this.s = this.mode === 'strong' ? getStore({ name: this.name, consistency: 'strong' }) : getStore(this.name);
    return this.s;
  }
  async run(fn) {
    try { return await fn(this.store()); } catch (e) {
      if (this.mode === 'strong' && /consisten|uncachedEdgeURL/i.test(String(e && e.message))) {
        console.warn('Netlify Blobs: strong consistency unavailable, using eventual:', e.message);
        this.mode = 'eventual'; this.s = null;
        return fn(this.store());
      }
      throw e;
    }
  }
  get(k) { return this.run((s) => s.get(enc(k), { type: 'json' })); }
  set(k, v) { return this.run((s) => s.setJSON(enc(k), v)); }
  del(k) { return this.run((s) => s.delete(enc(k))); }
  async keys(prefix) {
    const { blobs } = await this.run((s) => s.list({ prefix: enc(prefix) }));
    return blobs.map((b) => dec(b.key)).sort();
  }
}

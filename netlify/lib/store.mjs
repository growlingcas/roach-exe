// Claims store on top of a tiny key-value interface: get(key) → object|null, set(key, obj), del(key), keys(prefix) → string[].
// On Netlify the KV is Netlify Blobs (see blobs.mjs); in tests it is an in-memory Map (MemKV below).
//
// Keys
//   c/<handle>         claim record (last write wins)
//   w/<wallet>         handle that owns the wallet
//   ref/<handle>       { count, bonus } earned by a referrer
//   meta/pool          { reserved, count } running totals (rebuild with POST /api/admin/recount)
//   rl/<key>/<window>  rate-limit counter
//   sc/<key>           score cache { t, v }

const r2 = (v) => Math.round(v * 100) / 100;

export class MemKV {
  constructor() { this.m = new Map(); }
  async get(k) { const v = this.m.get(k); return v === undefined ? null : JSON.parse(v); }
  async set(k, v) { this.m.set(k, JSON.stringify(v)); }
  async del(k) { this.m.delete(k); }
  async keys(prefix) { return [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort(); }
}

export class Store {
  constructor(kv) { this.kv = kv; }
  get(handle) { return this.kv.get('c/' + handle); }
  async getByWallet(wallet) { const h = await this.kv.get('w/' + wallet); return h ? this.get(h) : null; }
  async refStats(handle) { return (await this.kv.get('ref/' + handle)) || { count: 0, bonus: 0 }; }
  async pool() { return (await this.kv.get('meta/pool')) || { reserved: 0, count: 0 }; }

  async _ref(rec, sign) {
    if (!rec || !rec.refBy || !rec.refBonus) return;
    const r = await this.refStats(rec.refBy);
    await this.kv.set('ref/' + rec.refBy, { count: r.count + sign, bonus: r2(r.bonus + sign * rec.refBonus) });
  }

  async put(rec) {
    const old = await this.get(rec.handle);
    await this.kv.set('c/' + rec.handle, rec);
    if (old && old.wallet !== rec.wallet) await this.kv.del('w/' + old.wallet);
    await this.kv.set('w/' + rec.wallet, rec.handle);
    const p = await this.pool();
    const delta = rec.amt + (rec.refBonus || 0) - (old ? old.amt + (old.refBonus || 0) : 0);
    await this.kv.set('meta/pool', { reserved: r2(p.reserved + delta), count: p.count + (old ? 0 : 1) });
    if (old) await this._ref(old, -1);
    await this._ref(rec, +1);
    return rec;
  }

  async handles() { return (await this.kv.keys('c/')).map((k) => k.slice(2)); }
  async many(handles) {
    const out = [];
    for (let i = 0; i < handles.length; i += 50) out.push(...(await Promise.all(handles.slice(i, i + 50).map((h) => this.get(h)))));
    return out.filter(Boolean);
  }
  async all() { return this.many(await this.handles()); }

  // rebuild totals and referral counters from the claim records
  async recount() {
    const all = await this.all();
    let reserved = 0; const refs = new Map();
    for (const r of all) {
      reserved += r.amt + (r.refBonus || 0);
      if (r.refBy && r.refBonus) { const x = refs.get(r.refBy) || { count: 0, bonus: 0 }; x.count++; x.bonus = r2(x.bonus + r.refBonus); refs.set(r.refBy, x); }
    }
    for (const k of await this.kv.keys('ref/')) if (!refs.has(k.slice(4))) await this.kv.del(k);
    for (const [h, x] of refs) await this.kv.set('ref/' + h, x);
    const p = { reserved: r2(reserved), count: all.length };
    await this.kv.set('meta/pool', p);
    return p;
  }

  // fixed-window counter; returns true when the limit is exceeded
  async limited(key, max, windowMs) {
    const k = `rl/${key}/${Math.floor(Date.now() / windowMs)}`;
    const n = ((await this.kv.get(k)) || 0) + 1;
    await this.kv.set(k, n);
    return n > max;
  }

  async cacheGet(key, ttlMs) { const c = await this.kv.get('sc/' + key); return c && Date.now() - c.t < ttlMs ? c.v : null; }
  cacheSet(key, v) { return this.kv.set('sc/' + key, { t: Date.now(), v }); }
  cacheDel(key) { return this.kv.del('sc/' + key); }
}

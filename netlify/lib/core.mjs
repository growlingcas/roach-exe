// PRAY offering API (Web Request → Response). Same routes and rules as pray-core/server.js,
// storage goes through Store (Netlify Blobs in production).
import { scoreAll, checkTasks } from './scoring.mjs';
import { verifyClaimSig } from './sig.mjs';
import * as X from './xauth.mjs';

export const VERSION = '2.2.0-netlify';
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const r2 = (v) => Math.round(v * 100) / 100;

function parseWallet(b) {
  const raw = String(b.wallet || '').trim();
  const chain = b.chain === 'sol' || (!raw.startsWith('0x') && SOL_RE.test(raw)) ? 'sol' : 'evm';
  if (chain === 'sol') return SOL_RE.test(raw) ? { chain, wallet: raw } : { error: 'Use a Solana address: 32–44 characters, base58.' };
  return ADDR_RE.test(raw) ? { chain, wallet: raw.toLowerCase() } : { error: 'Use a full EVM address: 0x and 40 characters.' };
}
const normHandle = (h) => String(h || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0];
const mask = (w) => w.slice(0, 6) + '…' + w.slice(-4);

export function createApi({ store, cfg, env }) {
  const cors = () => { const o = cfg.server.corsOrigin; return o ? { 'access-control-allow-origin': o, 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS' } : {}; };
  const send = (code, body, headers = {}) => {
    const isStr = typeof body === 'string';
    return new Response(code === 204 ? null : isStr ? body : JSON.stringify(body), { status: code, headers: { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...cors(), ...headers } });
  };
  const pool = async () => {
    const p = await store.pool();
    return { capUsd: cfg.pool.capUsd, reservedUsd: r2(p.reserved), remainingUsd: Math.max(0, r2(cfg.pool.capUsd - p.reserved)), claims: p.count, open: cfg.pool.open && p.reserved < cfg.pool.capUsd };
  };
  const pub = async (r) => {
    const rf = await store.refStats(r.handle);
    return { handle: r.handle, chain: r.chain || 'evm', wallet: mask(r.wallet), dest: r.dest, design: r.design, amt: r.amt, total: r.total, rows: r.rows, flags: r.flags, at: r.at, refBy: r.refBy || null, referrals: { count: rf.count, bonusUsd: rf.bonus, rate: cfg.referral.rate }, totalUsd: r2(r.amt + rf.bonus) };
  };
  const score = async (handle, wallet, chain = 'evm', fresh = false) => {
    const k = handle.toLowerCase() + '|' + chain + '|' + wallet;
    if (!fresh) { const c = await store.cacheGet(k, cfg.cacheMin * 60e3); if (c) return c; }
    const v = await scoreAll(handle, wallet, cfg, env, chain);
    await store.cacheSet(k, v);
    return v;
  };
  const readBody = async (req) => {
    const s = await req.text();
    if (s.length > 4096) throw Object.assign(new Error('too large'), { code: 413 });
    try { return s ? JSON.parse(s) : {}; } catch { throw Object.assign(new Error('bad json'), { code: 400 }); }
  };

  const xAuthOn = () => cfg.requireXAuth && X.configured(env);
  const redirect = (loc, headers = {}) => new Response(null, { status: 302, headers: { location: loc, 'cache-control': 'no-store', ...headers } });
  const safeRet = (r) => (r && /^\/(?!\/)[^\s]*$/.test(r) ? r.slice(0, 300) : '/');
  const withQ = (path, k, v) => { const u = new URL(path, 'https://x.local'); u.searchParams.set(k, v); return u.pathname + u.search + (u.hash || '#offering'); };
  const xSession = async (req) => {
    const sid = X.sidFrom(env, req); if (!sid) return null;
    const s = await store.kv.get('xs/' + sid);
    return s && Date.now() - s.at < X.SESSION_MS ? s : null;
  };

  async function route(req, ip) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '');
    if (req.method === 'OPTIONS') return send(204, '');
    if (p === '/api/health') return send(200, { ok: true, version: VERSION, pool: await pool(), x: { auth: xAuthOn(), account: cfg.x.account || '', postId: cfg.x.postId || '', requireTasks: !!cfg.x.requireTasks } });

    /* ---------- Connect X (Sign in with X) ---------- */
    if (p === '/api/x/login' && req.method === 'GET') {
      if (!X.configured(env)) return send(503, { error: 'x_not_configured', message: 'X sign-in is not set up yet.' });
      if (await store.limited('xl:' + ip, 30, 3600e3)) return send(429, { error: 'rate_limited', message: 'Too many attempts. Try again later.' });
      const ret = safeRet(url.searchParams.get('ret'));
      try {
        const rt = await X.requestToken(env, url.origin + '/api/x/callback');
        await store.kv.set('ot/' + rt.token, { secret: rt.secret, ret, at: Date.now() });
        return redirect(X.authorizeUrl(rt.token));
      } catch (e) { console.error('x login:', e.message); return redirect(withQ(ret, 'xerr', 'unavailable')); }
    }
    if (p === '/api/x/callback' && req.method === 'GET') {
      const tok = url.searchParams.get('oauth_token') || url.searchParams.get('denied') || '';
      const pend = tok ? await store.kv.get('ot/' + tok) : null;
      if (tok) await store.kv.del('ot/' + tok);
      const ret = pend ? pend.ret : '/';
      if (url.searchParams.get('denied')) return redirect(withQ(ret, 'xerr', 'denied'));
      if (!pend || Date.now() - pend.at > 15 * 60e3 || !url.searchParams.get('oauth_verifier')) return redirect(withQ(ret, 'xerr', 'expired'));
      try {
        const a = await X.accessToken(env, tok, pend.secret, url.searchParams.get('oauth_verifier'));
        if (!a.handle || !a.userId) throw new Error('no user in access token response');
        const sid = X.newSid();
        await store.kv.set('xs/' + sid, { userId: a.userId, handle: a.handle, token: a.token, secret: a.secret, at: Date.now() });
        return redirect(withQ(ret, 'x', 'ok'), { 'set-cookie': X.cookieFor(env, sid) });
      } catch (e) { console.error('x callback:', e.message); return redirect(withQ(ret, 'xerr', 'failed')); }
    }
    if (p === '/api/x/me') {
      const sess = await xSession(req);
      return sess ? send(200, { handle: sess.handle, userId: sess.userId }) : send(401, { error: 'not_connected' });
    }
    if (p === '/api/x/logout' && req.method === 'POST') {
      const sid = X.sidFrom(env, req); if (sid) await store.kv.del('xs/' + sid);
      return send(200, { ok: true }, { 'set-cookie': X.cookieFor(env, '') });
    }
    if (p === '/api/stats') return send(200, await pool());

    if (p === '/api/score' && req.method === 'POST') {
      if (await store.limited('s:' + ip, cfg.rateLimit.scorePerMin, 60e3)) return send(429, { error: 'rate_limited', message: 'Too many requests. Try again in a minute.' });
      const b = await readBody(req); const handle = normHandle(b.handle || 'anon'); const pw = parseWallet(b);
      if (pw.error) return send(400, { error: 'bad_wallet', message: pw.error });
      return send(200, await score(HANDLE_RE.test(handle) ? handle : 'anon', pw.wallet, pw.chain));
    }

    if (p === '/api/claim' && req.method === 'GET') {
      const r = await store.get(normHandle(url.searchParams.get('handle')).toLowerCase());
      return r ? send(200, await pub(r)) : send(404, { error: 'not_found' });
    }

    if (p === '/api/claim' && req.method === 'POST') {
      const b = await readBody(req);
      // with Connect X on, the handle comes from the signed-in X session, never from the request body
      const sess = xAuthOn() ? await xSession(req) : null;
      if (xAuthOn() && !sess) return send(401, { error: 'x_required', message: 'Connect your X account to claim.' });
      const handleRaw = sess ? sess.handle : normHandle(b.handle), handle = handleRaw.toLowerCase(), pw = parseWallet(b), { wallet, chain } = pw;
      if (!HANDLE_RE.test(handleRaw)) return send(400, { error: 'bad_handle', message: 'Use letters, numbers and underscores, up to 15 characters.' });
      if (pw.error) return send(400, { error: 'bad_wallet', message: pw.error });
      const dest = 'trade'; // the offering always lands on the trading balance
      // wallet ownership: the connected wallet signs the claim message (see sig.mjs)
      if (cfg.requireSignature) {
        if (!b.sig || !b.issuedAt) return send(401, { error: 'signature_required', message: 'Connect your wallet and sign to claim.' });
        const v = verifyClaimSig({ handle: handleRaw, wallet, chain, sig: b.sig, issuedAt: b.issuedAt });
        if (!v.ok) return send(401, { error: v.reason, message: v.reason === 'expired' ? 'The signature expired. Sign again to claim.' : 'The signature does not match this wallet. Connect the wallet you added and sign again.' });
      }
      const existing = await store.get(handle);
      if (existing) {
        if (existing.wallet === wallet) return send(200, { ...(await pub(existing)), existing: true, pool: await pool() });
        return send(409, { error: 'handle_taken', message: `@${handleRaw} already claimed with another wallet.` });
      }
      if (await store.getByWallet(wallet)) return send(409, { error: 'wallet_taken', message: 'This wallet is already linked to another X account.' });
      if (await store.limited('c:' + ip, cfg.rateLimit.claimsPerHourPerIp, 3600e3)) return send(429, { error: 'rate_limited', message: 'Too many claims from this network. Try again later.' });
      if (!(await pool()).open) return send(409, { error: 'pool_closed', message: 'The offering pool is fully reserved.' });

      // scoring and X task checks run in parallel to stay inside the function time limit
      const [s, tc, liked] = await Promise.all([score(handleRaw, wallet, chain), checkTasks(handleRaw, cfg, env),
        sess && cfg.x.postId ? X.likedPost(env, sess, cfg.x.postId) : Promise.resolve(undefined)]);
      if (liked !== undefined) { tc.checked = true; tc.out.like = liked; }
      const tasks = Object.fromEntries(['follow', 'like', 'rt'].map((k) => [k, !!(b.tasks && b.tasks[k])]));
      let tasksVerified = false;
      if (tc.checked) {
        const need = [];
        if (cfg.x.account && tc.out.follow === false) need.push('follow @' + cfg.x.account);
        if (cfg.x.postId && tc.out.like === false) need.push('like the launch post');
        if (cfg.x.postId && tc.out.rt === false) need.push('repost the launch post');
        if (cfg.x.requireTasks && need.length) return send(409, { error: 'tasks_incomplete', message: `Almost there: ${need.join(' and ')}, then claim again.`, missing: need });
        tasksVerified = !need.length && Object.values(tc.out).every((v) => v !== null);
        Object.assign(tasks, Object.fromEntries(Object.entries(tc.out).filter(([, v]) => v !== null && v !== undefined)));
      }
      // re-check after the async work (another request may have taken the handle or wallet meanwhile)
      if ((await store.get(handle)) || (await store.getByWallet(wallet))) return send(409, { error: 'conflict', message: 'This handle or wallet was just claimed. Refresh and try again.' });
      const reserved = (await store.pool()).reserved;
      let amt = s.amt;
      if (cfg.pool.capUsd - reserved < amt) amt = Math.floor((cfg.pool.capUsd - reserved) * 10) / 10;
      if (amt < cfg.payout.min) return send(409, { error: 'pool_closed', message: 'The offering pool is fully reserved.' });
      let refBy = null, refBonus = 0; const flags = [...s.flags];
      const refH = normHandle(b.ref).toLowerCase();
      if (refH && HANDLE_RE.test(refH) && refH !== handle) {
        const referrer = await store.get(refH);
        if (!referrer) flags.push('ref_unknown');
        else if (referrer.ip === ip) flags.push('ref_same_ip');
        else {
          refBy = refH;
          refBonus = Math.floor(amt * cfg.referral.rate * 100) / 100;
          const got = (await store.refStats(refH)).bonus;
          if (cfg.referral.maxBonusUsd > 0) refBonus = Math.max(0, Math.min(refBonus, cfg.referral.maxBonusUsd - got));
          refBonus = Math.max(0, Math.min(refBonus, Math.floor((cfg.pool.capUsd - reserved - amt) * 100) / 100));
        }
      }
      const rec = await store.put({
        handle, handleDisplay: handleRaw, xId: sess ? sess.userId : null, xVerified: !!sess, wallet, chain, dest, design: String(b.design || '').slice(0, 20), amt, total: s.total, rows: s.rows,
        flags, tasks, tasksVerified, ip, ua: String(req.headers.get('user-agent') || '').slice(0, 160), refBy, refBonus, at: new Date().toISOString(),
      });
      return send(201, { ...(await pub(rec)), pool: await pool() });
    }

    /* ---------- admin (Authorization: Bearer ADMIN_TOKEN) ---------- */
    if (p.startsWith('/api/admin/')) {
      if (!env.ADMIN_TOKEN || req.headers.get('authorization') !== 'Bearer ' + env.ADMIN_TOKEN) return send(401, { error: 'unauthorized' });
      if (p === '/api/admin/claims.csv') {
        // ?offset=0&limit=3000 — page through large exports; X-Total-Count has the total
        const handles = await store.handles();
        const off = Math.max(0, +url.searchParams.get('offset') || 0), lim = Math.min(5000, +url.searchParams.get('limit') || 3000);
        const recs = await store.many(handles.slice(off, off + lim));
        const cols = ['handleDisplay', 'chain', 'wallet', 'dest', 'amt', 'refEarned', 'payoutTotal', 'total', 'refBy', 'refBonus', 'flags', 'tasks', 'tasksVerified', 'ip', 'at'];
        const esc = (v) => { v = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        const rows = await Promise.all(recs.map(async (r) => { const rf = await store.refStats(r.handle); const x = { ...r, refEarned: rf.bonus, payoutTotal: r2(r.amt + rf.bonus) }; return cols.map((c) => esc(x[c])).join(','); }));
        return send(200, [cols.join(','), ...rows].join('\n'), { 'content-type': 'text/csv; charset=utf-8', 'x-total-count': String(handles.length) });
      }
      if (p === '/api/admin/recount' && req.method === 'POST') return send(200, { pool: await store.recount() });
      if (p === '/api/admin/rescore' && req.method === 'POST') {
        // ?limit=20 per call (function time limit); call again until "left" is 0
        const lim = Math.min(50, +url.searchParams.get('limit') || 20);
        const todo = (await store.all()).filter((r) => (r.flags || []).includes('needs_rescore'));
        let changed = 0;
        for (const r of todo.slice(0, lim)) {
          const s = await score(r.handleDisplay || r.handle, r.wallet, r.chain || 'evm', true);
          const room = Math.max(0, cfg.pool.capUsd - (await store.pool()).reserved);
          const amt = Math.max(r.amt, Math.min(s.amt, r.amt + room));
          await store.put({ ...r, amt, refBonus: r.refBy ? Math.floor(amt * cfg.referral.rate * 100) / 100 : 0, total: s.total, rows: s.rows, flags: s.flags, rescoredAt: new Date().toISOString() });
          changed++;
        }
        return send(200, { rescored: changed, left: Math.max(0, todo.length - changed), pool: await pool() });
      }
      return send(404, { error: 'not_found' });
    }
    return send(404, { error: 'not_found' });
  }

  return async function handle(req, ip = '?') {
    try { return await route(req, ip); } catch (e) {
      console.error(new Date().toISOString(), req.method, req.url, e.message);
      return send(e.code || 500, { error: 'server_error', message: e.code ? e.message : 'Something went wrong. Try again.', detail: String((e && e.name) || 'Error') + ': ' + String((e && e.message) || '').slice(0, 240) });
    }
  };
}

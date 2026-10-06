// PRAY offering — server-side scoring (ESM port of pray-core/scoring.js)
// PRAY offering — server-side scoring. Every scorer returns
// { pts, max, status: 'ok'|'none'|'unavailable'|'unconfigured', note }
//   ok           — data read, activity found
//   none         — data read, no activity
//   unavailable  — source failed (timeout/error); counts 0, record is flagged for rescore
//   unconfigured — no key / no contract list yet; counts 0

const log10 = (x) => Math.log10(Math.max(0, +x || 0) + 1);
const cap = (v, m) => Math.max(0, Math.min(m, Math.round(v)));

async function fetchJSON(url, opt = {}, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: c.signal, headers: { 'user-agent': 'pray-core/1.0', ...(opt.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------- X profile: twitterapi.io (TWITTERAPI_KEY) or official X API (X_BEARER_TOKEN) ---------- */
const TWAPI = 'https://api.twitterapi.io';
const tw = (path, env) => fetchJSON(TWAPI + path, { headers: { 'x-api-key': env.TWITTERAPI_KEY } }, 8000);
async function xProfile(handle, env) {
  if (env.TWITTERAPI_KEY) {
    const j = await tw(`/twitter/user/info?userName=${encodeURIComponent(handle)}`, env);
    const u = j && j.data;
    if (!u || !u.createdAt) return null;
    return { createdAt: u.createdAt, followers: +u.followers || 0, tweets: +u.statusesCount || 0, blue: !!u.isBlueVerified, automated: !!u.isAutomated, protected: !!u.protected };
  }
  const j = await fetchJSON(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=created_at,public_metrics,verified`, { headers: { authorization: 'Bearer ' + env.X_BEARER_TOKEN } });
  const u = j && j.data; if (!u) return null; const m = u.public_metrics || {};
  return { createdAt: u.created_at, followers: +m.followers_count || 0, tweets: +m.tweet_count || 0, blue: false, automated: false, protected: false };
}
async function scoreX(handle, cfg, env) {
  const max = cfg.weights.x;
  if (!env.TWITTERAPI_KEY && !env.X_BEARER_TOKEN) return { pts: 0, max, status: 'unconfigured', note: 'X API key not set' };
  try {
    const u = await xProfile(handle, env);
    if (!u) return { pts: 0, max, status: 'none', note: 'account not found' };
    const ageDays = (Date.now() - Date.parse(u.createdAt)) / 864e5;
    // young or bot-labelled accounts still get a small floor instead of zero
    const floor = cap(cfg.antiSybil.youngXPts * max / 300, max);
    if (ageDays < cfg.antiSybil.minXAgeDays) return { pts: floor, max, status: 'ok', note: `new account · ${Math.floor(ageDays)} days old`, young: true };
    if (u.automated) return { pts: floor, max, status: 'ok', note: 'automated account', young: true };
    // age: 3 years → 110 · followers: 100k → 120 (log) · posts: 10k → 50 (log) · blue check: 20
    const pts = Math.min(110, ageDays / 1095 * 110) + Math.min(120, log10(u.followers) / 5 * 120) + Math.min(50, log10(u.tweets) / 4 * 50) + (u.blue ? 20 : 0);
    return { pts: cap(pts * max / 300, max), max, status: 'ok', note: `${u.followers.toLocaleString('en-US')} followers · ${Math.floor(ageDays / 30)} mo${u.blue ? ' · blue' : ''}` };
  } catch (e) { return { pts: 0, max, status: 'unavailable', note: e.message }; }
}

/* ---------- X task checks (twitterapi.io). Likes are private on X since 2024, so only follow / repost / reply are checkable. ---------- */
async function checkTasks(handle, cfg, env) {
  const out = {};
  const x = cfg.x || {};
  if (!env.TWITTERAPI_KEY) return { checked: false, out };
  const h = handle.toLowerCase();
  const jobs = [];
  if (x.account) jobs.push(tw(`/twitter/user/check_follow_relationship?source_user_name=${encodeURIComponent(handle)}&target_user_name=${encodeURIComponent(x.account)}`, env)
    .then((j) => { out.follow = !!(j && j.data && j.data.following); }).catch(() => { out.follow = null; }));
  if (x.postId) {
    // 1) user's own recent timeline: retweets and replies show up there (one call)
    jobs.push(tw(`/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}`, env).then(async (j) => {
      const list = (j && ((j.data && j.data.tweets) || j.tweets)) || [];
      out.rt = list.some((t) => t.retweeted_tweet && String(t.retweeted_tweet.id) === String(x.postId)) || undefined;
      out.reply = list.some((t) => String(t.inReplyToId) === String(x.postId) || (t.quoted_tweet && String(t.quoted_tweet.id) === String(x.postId))) || undefined;
      // 2) fallback for repost: scan the post's retweeters (20 per page)
      if (!out.rt) {
        let cursor = '', found = false;
        for (let p = 0; p < (x.retweeterPages || 10) && !found; p++) {
          const r = await tw(`/twitter/tweet/retweeters?tweetId=${x.postId}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, env);
          found = (r.users || []).some((u) => String(u.userName).toLowerCase() === h);
          if (!r.has_next_page || !r.next_cursor) break; cursor = r.next_cursor;
        }
        out.rt = found;
      }
      out.reply = !!out.reply;
    }).catch(() => { out.rt = null; out.reply = null; }));
  }
  await Promise.all(jobs);
  return { checked: true, out };
}

/* ---------- Hyperliquid (public info API) ---------- */
async function scoreHyperliquid(wallet, cfg) {
  const max = cfg.weights.hyperliquid;
  const post = (body) => fetchJSON('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const [rl, fills, ch] = await Promise.all([
      post({ type: 'userRateLimit', user: wallet }),
      post({ type: 'userFills', user: wallet }),
      post({ type: 'clearinghouseState', user: wallet }),
    ]);
    const vol = +(rl && rl.cumVlm) || 0;
    const n = Array.isArray(fills) ? fills.length : 0;
    const av = +(ch && ch.marginSummary && ch.marginSummary.accountValue) || 0;
    if (!vol && !n && !av) return { pts: 0, max, status: 'none', note: 'no activity' };
    const pts = Math.min(120, log10(vol) * 17) + Math.min(40, log10(n) * 15) + Math.min(40, log10(av) * 10);
    return { pts: cap(pts * max / 200, max), max, status: 'ok', note: `$${fmtK(vol)} volume · ${n >= 2000 ? '2000+' : n} fills`, vol };
  } catch (e) { return { pts: 0, max, status: 'unavailable', note: e.message }; }
}

/* ---------- Lighter (public account lookup by L1 address) ---------- */
async function scoreLighter(wallet, cfg) {
  const max = cfg.weights.lighter;
  try {
    const j = await fetchJSON(`https://mainnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${wallet}`);
    const accs = (j && (j.accounts || j.sub_accounts)) || [];
    if (!accs.length) return { pts: 0, max, status: 'none', note: 'no account' };
    let col = 0, pos = 0, vol = 0;
    for (const a of accs) {
      col += +(a.collateral || a.total_asset_value || 0);
      vol += +(a.total_volume || a.volume || 0);
      for (const p of (a.positions || [])) if (+p.position || +p.position_value) pos++;
    }
    const pts = 30 + Math.min(35, log10(col) * 9) + Math.min(20, log10(vol) * 4) + Math.min(15, pos * 5);
    return { pts: cap(pts * max / 100, max), max, status: 'ok', note: `${accs.length} account${accs.length > 1 ? 's' : ''} · $${fmtK(col)} collateral` };
  } catch (e) {
    if (/HTTP 4\d\d/.test(e.message)) return { pts: 0, max, status: 'none', note: 'no account' };
    return { pts: 0, max, status: 'unavailable', note: e.message };
  }
}

/* ---------- Derive (public trade history by wallet) ---------- */
async function scoreDerive(wallet, cfg) {
  const max = cfg.weights.derive;
  const base = cfg.derive && cfg.derive.api;
  if (!base) return { pts: 0, max, status: 'unconfigured', note: 'API not set' };
  try {
    const j = await fetchJSON(base + '/public/get_trade_history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, page_size: 1000 }) });
    const trades = (j && j.result && (j.result.trades || j.result)) || [];
    const n = Array.isArray(trades) ? trades.length : 0;
    if (!n) return { pts: 0, max, status: 'none', note: 'no trades' };
    const first = Math.min(...trades.map((t) => +t.timestamp || Date.now()));
    const ageDays = (Date.now() - first) / 864e5;
    const pts = 30 + Math.min(50, log10(n) * 25) + Math.min(20, ageDays / 9);
    return { pts: cap(pts * max / 100, max), max, status: 'ok', note: `${n >= 1000 ? '1000+' : n} trade${n === 1 ? '' : 's'}` };
  } catch (e) { return { pts: 0, max, status: 'unavailable', note: e.message }; }
}

/* ---------- On-chain venues via Etherscan-compatible explorers (not used in the default set; kept for adding venues later) ----------
   cfg.venues[name] = [{ chain: 'bsc', contracts: ['0x…'] }, …]
   cfg.explorers[chain] = { url: 'https://api.etherscan.io/v2/api', chainid: 56, keyEnv: 'ETHERSCAN_KEY' }  */
async function scoreOnchain(name, wallet, cfg, env) {
  const max = cfg.weights[name.toLowerCase()];
  const targets = ((cfg.venues || {})[name] || []).filter((t) => t.contracts && t.contracts.length);
  if (!targets.length) return { pts: 0, max, status: 'unconfigured', note: 'contracts not set' };
  let n = 0, first = Infinity, failed = 0, planBlocked = 0;
  for (const t of targets) {
    const ex = cfg.explorers[t.chain];
    if (!ex) { failed++; continue; }
    const key = ex.keyEnv ? env[ex.keyEnv] : '';
    if (ex.keyEnv && !key) { failed++; continue; }
    const set = new Set(t.contracts.map((a) => a.toLowerCase()));
    const q = new URLSearchParams({ module: 'account', address: wallet, startblock: '0', endblock: '999999999', page: '1', offset: '1000', sort: 'asc' });
    if (ex.chainid) q.set('chainid', String(ex.chainid));
    if (key) q.set('apikey', key);
    try {
      for (const action of ['txlist', 'tokentx']) {
        q.set('action', action);
        const j = await fetchJSON(ex.url + '?' + q.toString());
        const rows = Array.isArray(j.result) ? j.result : [];
        if (!Array.isArray(j.result) && !/No transactions/i.test(j.message || '')) throw new Error(String(j.result || j.message).slice(0, 80));
        for (const r of rows) {
          if (set.has(String(r.to).toLowerCase())) { n++; first = Math.min(first, +r.timeStamp * 1000); }
        }
      }
    } catch (e) { failed++; if (/not supported for this chain|upgrade your api plan/i.test(e.message)) planBlocked++; }
  }
  if (!n && planBlocked === targets.length) return { pts: 0, max, status: 'unconfigured', note: 'explorer plan does not cover this chain' };
  if (!n && failed === targets.length) return { pts: 0, max, status: 'unavailable', note: 'explorer unreachable' };
  if (!n) return { pts: 0, max, status: 'none', note: 'no interactions' };
  const ageDays = (Date.now() - first) / 864e5;
  const pts = 30 + Math.min(50, log10(n) * 25) + Math.min(20, ageDays / 9);
  return { pts: cap(pts * max / 100, max), max, status: 'ok', note: `${n} interaction${n > 1 ? 's' : ''} · since ${new Date(first).toISOString().slice(0, 10)}` };
}


/* ---------- Solana (Helius): transaction count, wallet age, volume ---------- */
const STABLES = { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1, Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 1 };
const WSOL = 'So11111111111111111111111111111111111111112';
let solPx = { v: 0, t: 0 };
async function heliusRpc(key, method, params) {
  const j = await fetchJSON(`https://mainnet.helius-rpc.com/?api-key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, 8000);
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}
async function solPrice(key, cfg) {
  if (Date.now() - solPx.t < 600e3 && solPx.v) return solPx.v;
  try { const a = await heliusRpc(key, 'getAsset', { id: WSOL }); const p = +(a && a.token_info && a.token_info.price_info && a.token_info.price_info.price_per_token); if (p > 0) solPx = { v: p, t: Date.now() }; } catch { /* keep last */ }
  return solPx.v || cfg.sol.fallbackPriceUsd;
}
async function scoreSolana(wallet, cfg, env) {
  const key = env.HELIUS_API_KEY; const W = cfg.weights;
  const rows = (st, note, a = {}) => [
    { k: 'Transactions', pts: a.tx || 0, max: W.solTxs, status: st, note: a.txNote || note },
    { k: 'Wallet age', pts: a.age || 0, max: W.solAge, status: st, note: a.ageNote || note },
    { k: 'Volume', pts: a.vol || 0, max: W.solVolume, status: st, note: a.volNote || note },
  ];
  if (!key) return { rows: rows('unconfigured', 'Helius key not set'), active: false };
  try {
    // run the three reads in parallel: first transaction (age), signature count, recent parsed volume
    const firstTx = heliusRpc(key, 'getTransactionsForAddress', [wallet, { transactionDetails: 'signatures', sortOrder: 'asc', limit: 1 }])
      .then((r) => (r && r.data && r.data[0] && r.data[0].blockTime) || 0).catch(() => 0);
    const countSigs = (async () => {
      let n = 0, oldest = 0, before, capped = false;
      for (let p = 0; p < cfg.sol.maxSigPages; p++) {
        const page = await heliusRpc(key, 'getSignaturesForAddress', [wallet, { limit: 1000, ...(before ? { before } : {}) }]);
        if (!Array.isArray(page) || !page.length) break;
        for (const s of page) { if (!s.err) n++; if (s.blockTime) oldest = s.blockTime; }
        before = page[page.length - 1].signature;
        if (page.length < 1000) break;
        if (p === cfg.sol.maxSigPages - 1) capped = true;
      }
      return { n, oldest, capped };
    })();
    const volume = (async () => {
      const price = await solPrice(key, cfg);
      let usd = 0, parsed = 0, bfr;
      for (let p = 0; p < cfg.sol.volumePages; p++) {
        const q = new URLSearchParams({ 'api-key': key, limit: '100' }); if (bfr) q.set('before', bfr);
        const txs = await fetchJSON(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?${q}`, {}, 10000);
        if (!Array.isArray(txs) || !txs.length) break;
        for (const t of txs) {
          if (t.transactionError) continue; parsed++;
          let sol = 0, stable = 0;
          for (const x of t.nativeTransfers || []) if ((x.fromUserAccount === wallet || x.toUserAccount === wallet) && x.amount >= cfg.sol.dustLamports) sol += x.amount / 1e9;
          for (const x of t.tokenTransfers || []) {
            if (x.fromUserAccount !== wallet && x.toUserAccount !== wallet) continue;
            const amt = +x.tokenAmount || 0;
            if (STABLES[x.mint]) stable += amt; else if (x.mint === WSOL) sol += amt;
          }
          usd += Math.max(sol * price, stable); // a swap moves both legs; count the trade once
        }
        bfr = txs[txs.length - 1].signature;
        if (txs.length < 100) break;
      }
      return { usd, parsed };
    })();
    const [first, { n, oldest, capped }, { usd, parsed }] = await Promise.all([firstTx, countSigs, volume]);
    if (!n) return { rows: rows('none', 'no transactions'), active: false };
    const born = first || oldest;
    const ageDays = born ? (Date.now() / 1000 - born) / 86400 : 0;
    const tx = Math.min(W.solTxs, Math.round(log10(n) / log10(cfg.sol.fullTxs) * W.solTxs)); // fullTxs (5000) → max
    const age = Math.min(W.solAge, Math.round(ageDays / cfg.sol.fullAgeDays * W.solAge));  // 2 years → max
    const vol = Math.min(W.solVolume, Math.round(log10(usd) / 6 * W.solVolume));           // $1M → max
    const active = n >= cfg.sol.minTxs && ageDays >= cfg.sol.minAgeDays;
    return {
      rows: rows('ok', '', {
        tx, age, vol,
        txNote: `${capped ? n.toLocaleString('en-US') + '+' : n.toLocaleString('en-US')} transactions`,
        ageNote: `first seen ${new Date(born * 1000).toISOString().slice(0, 10)} · ${Math.floor(ageDays)} days`,
        volNote: `$${fmtK(usd)} in last ${parsed} transactions`,
      }),
      active,
    };
  } catch (e) { return { rows: rows('unavailable', e.message), active: false, failed: true }; }
}

function fmtK(v) { v = +v || 0; return v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0); }

/* ---------- formula ---------- */
function amountFor(total, cfg) {
  const { min, max, curve } = cfg.payout;
  const raw = min + (max - min) * Math.pow(Math.max(0, Math.min(1000, total)) / 1000, curve);
  return Math.max(min, Math.min(max, Math.floor(raw * 10 + 1e-9) / 10));
}

async function scoreAll(handle, wallet, cfg, env, chain = 'evm') {
  if (chain === 'sol') return scoreAllSol(handle, wallet, cfg, env);
  const [x, hl, li, de] = await Promise.all([
    scoreX(handle, cfg, env),
    scoreHyperliquid(wallet, cfg),
    scoreLighter(wallet, cfg),
    scoreDerive(wallet, cfg),
  ]);
  const rows = [
    { k: 'X presence', ...x }, { k: 'Hyperliquid', ...hl }, { k: 'Lighter', ...li },
    { k: 'Derive', ...de },
  ];
  // Normalise over the sources we could actually read (ok/none), so a missing API key or an outage
  // does not cap everyone's offering. Unconfigured/unavailable sources are left out of both sides.
  const counted = rows.filter((r) => r.status === 'ok' || r.status === 'none');
  const denom = counted.reduce((a, r) => a + r.max, 0);
  const raw = counted.reduce((a, r) => a + r.pts, 0);
  const total = denom ? Math.round(raw / denom * 1000) : 0;
  const venues = rows.slice(1);
  const anyTrading = venues.some((r) => r.status === 'ok');
  const flags = [];
  if (!anyTrading) flags.push('no_trading_activity');
  if (x.young) flags.push('young_x_account');
  if (rows.some((r) => r.status === 'unavailable')) flags.push('needs_rescore');
  // anti-sybil: no trading history anywhere → minimum payout regardless of X score
  const amt = (!anyTrading && cfg.antiSybil.minIfNoTrading) ? cfg.payout.min : amountFor(total, cfg);
  return { rows: rows.map(({ young, vol, ...r }) => r), total, raw, denom, amt, flags };
}

function finish(rows, anyTrading, cfg, extraFlags = []) {
  const counted = rows.filter((r) => r.status === 'ok' || r.status === 'none');
  const denom = counted.reduce((a, r) => a + r.max, 0);
  const raw = counted.reduce((a, r) => a + r.pts, 0);
  const total = denom ? Math.round(raw / denom * 1000) : 0;
  const flags = [...extraFlags];
  if (!anyTrading) flags.push('no_trading_activity');
  if (rows.some((r) => r.status === 'unavailable')) flags.push('needs_rescore');
  const amt = (!anyTrading && cfg.antiSybil.minIfNoTrading) ? cfg.payout.min : amountFor(total, cfg);
  return { rows: rows.map(({ young, vol, ...r }) => r), total, raw, denom, amt, flags };
}
async function scoreAllSol(handle, wallet, cfg, env) {
  const [x, s] = await Promise.all([scoreX(handle, cfg, env), scoreSolana(wallet, cfg, env)]);
  return { ...finish([{ k: 'X presence', ...x }, ...s.rows], s.active, cfg, x.young ? ['young_x_account'] : []), chain: 'sol' };
}

export { checkTasks, scoreSolana, scoreAll, amountFor, scoreX, scoreHyperliquid, scoreLighter, scoreDerive, scoreOnchain };

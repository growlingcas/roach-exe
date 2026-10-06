// Stubbed data sources (Hyperliquid, Lighter, Derive, Helius, twitterapi.io) for tests and the local dev server.
export const W_ACTIVE = '0x8ba1f109551bd432803012645ac136ddd64dba72';
export const W_EMPTY = '0x0000000000000000000000000000000000000001';
export const W_DOWN = '0x0000000000000000000000000000000000000002';
export const ASTER = '0x1b6f2d3844c6ae7d56ceb3c3643b9060ba28feb0';
export const SOL_ACTIVE = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY', SOL_EMPTY = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', SOL_NEW = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
export const now = Math.floor(Date.now() / 1000);
export const sigs = (n, oldestDays) => Array.from({ length: n }, (_, i) => ({ signature: 'sig' + i, err: null, blockTime: now - Math.round(i / Math.max(1, n - 1) * oldestDays * 86400) }));
export const SIGS = { [SOL_ACTIVE]: sigs(1500, 400), [SOL_EMPTY]: [], [SOL_NEW]: sigs(40, 10) };
export const X_LIKES = new Set();
export const J = (o, s = 200) => Promise.resolve(new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } }));
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); let body = {}; try { body = opt.body ? JSON.parse(opt.body) : {}; } catch { body = {}; }
  const who = (body.user || body.wallet || (url.match(/0x[0-9a-f]{40}/i) || [])[0] || '').toLowerCase();
  if (who === W_DOWN) throw new Error('ECONNRESET');
  if (url.includes('helius-rpc')) {
    const b = JSON.parse(opt.body);
    if (b.method === 'getTransactionsForAddress') { const all = SIGS[b.params[0]] || []; return J({ result: { data: all.length ? [all[all.length - 1]] : [] } }); }
    if (b.method === 'getAsset') return J({ result: { token_info: { price_info: { price_per_token: 120 } } } });
    if (b.method === 'getSignaturesForAddress') { const [w, o] = b.params; const all = SIGS[w] || []; const start = o.before ? all.findIndex((x) => x.signature === o.before) + 1 : 0; return J({ result: all.slice(start, start + o.limit) }); }
  }
  if (url.includes('api.helius.xyz')) {
    const w = url.match(/addresses\/([^/]+)\//)[1];
    if (w !== SOL_ACTIVE || url.includes('before=')) return J([]);
    return J([
      { signature: 'a', nativeTransfers: [{ fromUserAccount: w, toUserAccount: 'X', amount: 2e9 }], tokenTransfers: [] },
      { signature: 'b', nativeTransfers: [{ fromUserAccount: w, toUserAccount: 'pool', amount: 5e9 }], tokenTransfers: [{ fromUserAccount: 'pool', toUserAccount: w, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenAmount: 600 }] },
      { signature: 'c', nativeTransfers: [{ fromUserAccount: 'spammer', toUserAccount: 'other', amount: 9e9 }], tokenTransfers: [] },
      { signature: 'd', transactionError: { x: 1 }, nativeTransfers: [{ fromUserAccount: w, toUserAccount: 'X', amount: 9e9 }] },
    ]);
  }
  if (url.includes('hyperliquid')) {
    const active = who === W_ACTIVE;
    if (body.type === 'userRateLimit') return J({ cumVlm: active ? '2500000.0' : '0.0' });
    if (body.type === 'userFills') return J(active ? Array.from({ length: 640 }, () => ({})) : []);
    if (body.type === 'clearinghouseState') return J({ marginSummary: { accountValue: active ? '12000' : '0' } });
  }
  if (url.includes('zklighter')) return who === W_ACTIVE ? J({ accounts: [{ collateral: '3500', positions: [{ position: '1' }] }] }) : J({ code: 21100, message: 'account not found' }, 400);
  if (url.includes('etherscan')) {
    const rows = who === W_ACTIVE ? [{ to: ASTER, timeStamp: String(Math.floor(Date.now() / 1000) - 200 * 86400) }, { to: ASTER, timeStamp: String(Math.floor(Date.now() / 1000)) }] : [];
    return J(rows.length ? { status: '1', message: 'OK', result: rows } : { status: '0', message: 'No transactions found', result: [] });
  }
  if (url.includes('lyra')) return J({ result: { trades: who === W_ACTIVE ? [{ timestamp: Date.now() - 50 * 864e5 }] : [] } });
  if (url.includes('twitterapi.io')) {
    const u = new URL(url); const q = (k) => (u.searchParams.get(k) || '').toLowerCase();
    if (u.pathname.endsWith('/user/info')) {
      const n = q('userName');
      if (n === 'veteran') return J({ status: 'success', data: { userName: 'veteran', createdAt: '2019-03-01T00:00:00.000000Z', followers: 4200, statusesCount: 8000, isBlueVerified: true, isAutomated: false } });
      if (n === 'freshbot') return J({ status: 'success', data: { userName: 'freshbot', createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), followers: 2, statusesCount: 3 } });
      return J({ status: 'error', msg: 'User not found' });
    }
    if (u.pathname.endsWith('/check_follow_relationship')) return J({ status: 'success', data: { following: q('source_user_name') === 'doer', followed_by: false } });
    if (u.pathname.endsWith('/last_tweets')) return J({ status: 'success', data: { tweets: q('userName') === 'doer' ? [{ id: '9', retweeted_tweet: { id: '777' } }] : [{ id: '1' }] } });
    if (u.pathname.endsWith('/retweeters')) return J({ users: q('cursor') ? [{ userName: 'Lazy_RT' }] : [{ userName: 'someone' }], has_next_page: !q('cursor'), next_cursor: q('cursor') ? null : 'c1' });
  }
  if (url.includes('api.twitter.com/oauth/request_token')) { if (!String(opt.headers.authorization).includes('oauth_callback=')) return J({}, 401); return Promise.resolve(new Response('oauth_token=RT1&oauth_token_secret=RS1&oauth_callback_confirmed=true')); }
  if (url.includes('api.twitter.com/oauth/access_token')) { const v = new URLSearchParams(opt.body).get('oauth_verifier'); return Promise.resolve(new Response(v === 'good' ? 'oauth_token=AT1&oauth_token_secret=AS1&user_id=4242&screen_name=Real_Zeus' : 'bad', { status: v === 'good' ? 200 : 401 })); }
  if (url.includes('/liked_tweets')) return J({ data: X_LIKES.has(url.match(/users\/(\d+)/)[1]) ? [{ id: '1' }, { id: '777' }] : [{ id: '5' }] });
  if (url.includes('api.x.com')) return url.includes('/username/oldtimer') ? J({ data: { created_at: '2019-01-01T00:00:00Z', public_metrics: { followers_count: 5200, tweet_count: 9000 } } }) : J({});
  throw new Error('unexpected ' + url);
};


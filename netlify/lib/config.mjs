// Offering settings. Anything here can be overridden with environment variables in
// Netlify → Site configuration → Environment variables (see README).

export const defaults = {
  server: { corsOrigin: '' },
  pool: { capUsd: 25000, open: true },
  payout: { min: 0.5, max: 10, curve: 1.6 },
  referral: { rate: 0.10, maxBonusUsd: 0 },
  weights: { x: 300, hyperliquid: 400, lighter: 150, derive: 150, solTxs: 250, solAge: 200, solVolume: 250 },
  antiSybil: { minXAgeDays: 90, youngXPts: 40, minIfNoTrading: true },
  rateLimit: { claimsPerHourPerIp: 5, scorePerMin: 20 },
  cacheMin: 10,
  requireSignature: true, // claim only with a signature from the wallet (connect + sign)
  // retweeterPages is kept low so a claim fits the function time limit
  x: { account: 'prayperpdex', postId: '', requireTasks: true, retweeterPages: 3 },
  derive: { api: 'https://api.lyra.finance' },
  sol: { maxSigPages: 5, fullTxs: 5000, volumePages: 3, fullAgeDays: 730, minTxs: 5, minAgeDays: 30, dustLamports: 1000000, fallbackPriceUsd: 120 },
};

function deepMerge(a, b) { for (const k of Object.keys(b || {})) a[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? deepMerge(a[k] || {}, b[k]) : b[k]; return a; }
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
const bool = (v) => (v === undefined || v === '' ? undefined : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(env = process.env) {
  const cfg = deepMerge(JSON.parse(JSON.stringify(defaults)), env.PRAY_CONFIG ? JSON.parse(env.PRAY_CONFIG) : {});
  const set = (obj, key, v) => { if (v !== undefined && !(typeof v === 'number' && Number.isNaN(v))) obj[key] = v; };
  set(cfg.pool, 'capUsd', num(env.POOL_CAP_USD));
  set(cfg.pool, 'open', bool(env.POOL_OPEN));
  set(cfg.referral, 'rate', num(env.REFERRAL_RATE));
  set(cfg.referral, 'maxBonusUsd', num(env.REFERRAL_MAX_BONUS_USD));
  set(cfg.x, 'account', env.X_ACCOUNT);
  set(cfg.x, 'postId', env.X_POST_ID);
  set(cfg.x, 'requireTasks', bool(env.REQUIRE_TASKS));
  set(cfg.rateLimit, 'claimsPerHourPerIp', num(env.CLAIMS_PER_HOUR_PER_IP));
  set(cfg.server, 'corsOrigin', env.CORS_ORIGIN);
  set(cfg, 'requireSignature', bool(env.REQUIRE_WALLET_SIG));
  return cfg;
}

// "Connect X" — Sign in with X (OAuth 1.0a, 3-legged) + like check with the user's own token.
// Keys: X_CONSUMER_KEY / X_CONSUMER_SECRET (X Developer Console → your app → Consumer Key / Secret Key).
// Session: random id in an HttpOnly cookie, signed with SESSION_SECRET; the X tokens stay server-side in Blobs.
import crypto from 'node:crypto';

export const X_OAUTH = 'https://api.twitter.com/oauth';
export const X_API = 'https://api.x.com/2';
export const COOKIE = 'pray_x';
const SESSION_DAYS = 7;

const pct = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// OAuth 1.0a Authorization header (HMAC-SHA1). `params` = query + form params that are part of the signature.
export function oauthHeader({ method, url, params = {}, consumerKey, consumerSecret, token = '', tokenSecret = '', extra = {}, nonce, timestamp }) {
  const o = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...extra,
  };
  const all = { ...params, ...o };
  const base = [method.toUpperCase(), pct(url), pct(Object.keys(all).sort().map((k) => `${pct(k)}=${pct(all[k])}`).join('&'))].join('&');
  o.oauth_signature = crypto.createHmac('sha1', `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.keys(o).sort().map((k) => `${pct(k)}="${pct(o[k])}"`).join(', ');
}

async function call(method, url, { params = {}, body = null, ms = 8000, ...auth }) {
  const qs = new URLSearchParams(params).toString();
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const sigParams = { ...params, ...(body || {}) };
    const r = await fetch(url + (qs ? '?' + qs : ''), {
      method, signal: c.signal,
      headers: { authorization: oauthHeader({ method, url, params: sigParams, ...auth }), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`X ${r.status}: ${text.slice(0, 200)}`), { status: r.status });
    return text;
  } finally { clearTimeout(t); }
}

export const configured = (env) => !!(env.X_CONSUMER_KEY && env.X_CONSUMER_SECRET);
const keys = (env) => ({ consumerKey: env.X_CONSUMER_KEY, consumerSecret: env.X_CONSUMER_SECRET });

/* ---------- 3-legged flow ---------- */
export async function requestToken(env, callbackUrl) {
  const t = await call('POST', `${X_OAUTH}/request_token`, { ...keys(env), extra: { oauth_callback: callbackUrl } });
  const q = new URLSearchParams(t);
  if (q.get('oauth_callback_confirmed') !== 'true') throw new Error('X did not confirm the callback URL');
  return { token: q.get('oauth_token'), secret: q.get('oauth_token_secret') };
}
export const authorizeUrl = (token) => `${X_OAUTH}/authenticate?oauth_token=${encodeURIComponent(token)}`;
export async function accessToken(env, token, secret, verifier) {
  const t = await call('POST', `${X_OAUTH}/access_token`, { ...keys(env), token, tokenSecret: secret, body: { oauth_verifier: verifier } });
  const q = new URLSearchParams(t);
  return { token: q.get('oauth_token'), secret: q.get('oauth_token_secret'), userId: q.get('user_id'), handle: q.get('screen_name') };
}

/* ---------- like check: the user's own liked posts (likes are private to everyone but the owner) ---------- */
export async function likedPost(env, sess, postId) {
  try {
    const t = await call('GET', `${X_API}/users/${sess.userId}/liked_tweets`, { ...keys(env), token: sess.token, tokenSecret: sess.secret, params: { max_results: '10' } });
    const j = JSON.parse(t);
    return (j.data || []).some((p) => String(p.id) === String(postId));
  } catch (e) { console.warn('like check failed:', e.message); return null; } // null = could not check → don't block
}

/* ---------- session cookie ---------- */
const secretOf = (env) => env.SESSION_SECRET || crypto.createHash('sha256').update('pray-session|' + (env.X_CONSUMER_SECRET || '')).digest('hex');
const sign = (env, v) => crypto.createHmac('sha256', secretOf(env)).update(v).digest('base64url').slice(0, 32);
export const newSid = () => crypto.randomBytes(24).toString('base64url');
export function cookieFor(env, sid, maxAge = SESSION_DAYS * 86400) {
  return `${COOKIE}=${sid ? sid + '.' + sign(env, sid) : ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sid ? maxAge : 0}`;
}
export function sidFrom(env, req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`));
  if (!m) return null;
  const want = sign(env, m[1]);
  return want.length === m[2].length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2])) ? m[1] : null;
}
export const SESSION_MS = SESSION_DAYS * 86400e3;

// npm test — the API against stubbed data sources and an in-memory store (no network, no Netlify needed)
import assert from 'node:assert';
import { createApi } from '../netlify/lib/core.mjs';
import { Store, MemKV } from '../netlify/lib/store.mjs';
import { loadConfig } from '../netlify/lib/config.mjs';
import { evmSigner, solSigner } from './signers.mjs';
import { claimMessage } from '../netlify/lib/sig.mjs';
import { amountFor, scoreAll, scoreX, checkTasks } from '../netlify/lib/scoring.mjs';

const env = { HELIUS_API_KEY: 'hk', TWITTERAPI_KEY: '', X_BEARER_TOKEN: '', ADMIN_TOKEN: 'tkn' };
import { W_ACTIVE, W_EMPTY, W_DOWN, SOL_ACTIVE, SOL_EMPTY, SOL_NEW } from './stubs.mjs';

const cfg = loadConfig({}); cfg.x.account = ''; cfg.x.postId = ''; cfg.requireSignature = false; // signature checks have their own block below
const kv = new MemKV(); const store = new Store(kv);
const api = createApi({ store, cfg, env });
store.reservedNow = async () => (await store.pool()).reserved;
const req = async (method, p, body, headers = {}) => {
  const ip = (headers['x-forwarded-for'] || '127.0.0.1');
  const res = await api(new Request('https://pray.test' + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), ip);
  const s = await res.text(); let j; try { j = JSON.parse(s); } catch { j = s; }
  return { code: res.status, body: j, headers: res.headers };
};

(async () => {
  let n = 0; const ok = (name) => { n++; console.log('  ✓', name); };

  // formula
  assert.equal(amountFor(0, cfg), 0.5); assert.equal(amountFor(1000, cfg), 10); assert.equal(amountFor(500, cfg), 3.6); assert.equal(amountFor(250, cfg), 1.5); ok('payout curve 0→$0.50, 250→$1.50, 500→$3.60, 1000→$10');

  let r = await req('GET', '/api/health'); assert.equal(r.code, 200); assert.equal(r.body.pool.claims, 0); ok('health');

  r = await req('POST', '/api/score', { handle: 'zeus', wallet: W_ACTIVE });
  assert.equal(r.code, 200); const rows = Object.fromEntries(r.body.rows.map((x) => [x.k, x]));
  assert.equal(rows.Hyperliquid.status, 'ok'); assert.ok(rows.Hyperliquid.pts > 100, 'HL pts ' + rows.Hyperliquid.pts);
  assert.equal(rows.Lighter.status, 'ok'); assert.equal(rows.Derive.status, 'ok');
  assert.ok(!rows.Extended && !rows.Variational && !rows.Aster);
  assert.equal(rows['X presence'].status, 'unconfigured'); assert.equal(rows['X presence'].pts, 0);
  console.log('     active wallet:', r.body.rows.map((x) => `${x.k} ${x.pts}/${x.max} (${x.status})`).join(' · '), '→ total', r.body.total, '→ $' + r.body.amt);
  ok('active wallet scored from real-shaped API data');

  r = await req('POST', '/api/score', { handle: 'nobody', wallet: W_EMPTY });
  assert.equal(r.body.amt, 0.5); assert.ok(r.body.flags.includes('no_trading_activity')); ok('empty wallet → $0.50 floor, flagged');

  { const v = await scoreAll('oldtimer', W_EMPTY, cfg, { X_BEARER_TOKEN: 't' });
    const xr = v.rows.find((q) => q.k === 'X presence'); assert.equal(xr.status, 'ok'); assert.ok(xr.pts > 200); assert.equal(v.amt, 0.5);
    ok(`verified X (${xr.pts}/300) but empty wallet → $0.50 minimum`); }
  r = await req('POST', '/api/score', { handle: 'x', wallet: W_DOWN });
  assert.ok(r.body.flags.includes('needs_rescore')); assert.equal(r.body.rows.find((x) => x.k === 'Hyperliquid').status, 'unavailable'); ok('source outage → unavailable + needs_rescore, no fake points');

  r = await req('POST', '/api/claim', { handle: '@Zeus_Trader', wallet: W_ACTIVE, dest: 'trade', tasks: { like: true } });
  assert.equal(r.code, 201); const amt = r.body.amt; assert.ok(amt > 0.5); assert.equal(r.body.dest, 'trade'); assert.ok(r.body.wallet.includes('…')); ok(`claim created ($${amt}), wallet masked in response`);

  r = await req('POST', '/api/claim', { handle: 'zeus_trader', wallet: W_ACTIVE }); assert.equal(r.code, 200); assert.equal(r.body.existing, true); assert.equal(r.body.amt, amt); ok('same handle + wallet → idempotent, same amount');
  r = await req('POST', '/api/claim', { handle: 'zeus_trader', wallet: W_EMPTY }); assert.equal(r.code, 409); assert.equal(r.body.error, 'handle_taken'); ok('handle reused with other wallet → 409');
  r = await req('POST', '/api/claim', { handle: 'someone_else', wallet: W_ACTIVE }); assert.equal(r.code, 409); assert.equal(r.body.error, 'wallet_taken'); ok('wallet reused by other handle → 409');
  r = await req('POST', '/api/claim', { handle: 'bad handle!', wallet: W_EMPTY }); assert.equal(r.code, 400); ok('invalid handle → 400');
  r = await req('POST', '/api/claim', { handle: 'ok_name', wallet: '0x123' }); assert.equal(r.code, 400); ok('invalid wallet → 400');
  r = await req('GET', '/api/claim?handle=ZEUS_TRADER'); assert.equal(r.code, 200); assert.equal(r.body.amt, amt); ok('lookup by handle (case-insensitive)');

  // rate limit: 5 new claims per hour per IP (1 used above)
  const codes = [];
  for (let i = 0; i < 6; i++) { const w = '0x' + (100 + i).toString(16).padStart(40, '0'); codes.push((await req('POST', '/api/claim', { handle: 'u' + i, wallet: w })).code); }
  assert.deepEqual(codes, [201, 201, 201, 201, 429, 429]); ok('rate limit 5 claims/hour/IP');

  // pool cap
  const before = await store.reservedNow(); cfg.pool.capUsd = before + 0.7;
  r = await req('POST', '/api/claim', { handle: 'late1', wallet: W_EMPTY }, { 'x-forwarded-for': '9.9.9.9' }); assert.equal(r.code, 201); assert.equal(r.body.amt, 0.5);
  r = await req('POST', '/api/claim', { handle: 'late2', wallet: '0x' + 'ab'.repeat(20) }, { 'x-forwarded-for': '9.9.9.9' }); assert.equal(r.code, 409); assert.equal(r.body.error, 'pool_closed'); ok('pool cap enforced');
  cfg.pool.capUsd = 25000;

  // Solana (Helius)
  r = await req('POST', '/api/score', { handle: 'solguy', wallet: SOL_ACTIVE, chain: 'sol' });
  { const R = Object.fromEntries(r.body.rows.map((x) => [x.k, x]));
    assert.equal(R.Transactions.status, 'ok'); assert.ok(R.Transactions.note.startsWith('1,500')); assert.ok(R['Wallet age'].note.includes('400 days'));
    assert.ok(R.Volume.note.startsWith('$840'), R.Volume.note); assert.ok(!R.Hyperliquid); assert.ok(r.body.amt > 0.5);
    console.log('     sol wallet:', r.body.rows.map((x) => `${x.k} ${x.pts}/${x.max}`).join(' · '), '→', r.body.total, '→ $' + r.body.amt); }
  ok('Solana: tx count, age and volume (own legs only, swap counted once, spam and failed tx ignored)');
  r = await req('POST', '/api/score', { handle: 'x', wallet: SOL_EMPTY, chain: 'sol' }); assert.equal(r.body.amt, 0.5); ok('empty Solana wallet → $0.50');
  r = await req('POST', '/api/score', { handle: 'x', wallet: SOL_NEW, chain: 'sol' }); assert.equal(r.body.amt, 0.5); ok('Solana wallet younger than 30 days → $0.50');
  r = await req('POST', '/api/claim', { handle: 'solguy', wallet: SOL_ACTIVE, chain: 'sol' }, { 'x-forwarded-for': '7.7.7.7' }); assert.equal(r.code, 201); assert.equal(r.body.chain, 'sol');
  assert.ok((await store.get('solguy')).wallet === SOL_ACTIVE); ok('Solana claim stored, address case kept');
  r = await req('POST', '/api/claim', { handle: 'solbad', wallet: 'not-a-wallet', chain: 'sol' }, { 'x-forwarded-for': '7.7.7.8' }); assert.equal(r.code, 400); ok('invalid Solana address → 400');

  // twitterapi.io: profile score + task checks
  { const E = { TWITTERAPI_KEY: 'k' };
    let x = await scoreX('veteran', cfg, E); assert.equal(x.status, 'ok'); assert.ok(x.pts > 200, 'pts ' + x.pts); ok(`X profile via twitterapi.io: ${x.pts}/300 (${x.note})`);
    x = await scoreX('freshbot', cfg, E); assert.equal(x.pts, 40); assert.ok(x.young); ok('X account younger than 90 days → floor 40/300, flagged');
    x = await scoreX('ghost', cfg, E); assert.equal(x.status, 'none'); ok('unknown X handle → none');
    cfg.x.account = 'pray'; cfg.x.postId = '777';
    let t = await checkTasks('doer', cfg, E); assert.deepEqual([t.out.follow, t.out.rt], [true, true]); ok('follow + repost detected from timeline');
    t = await checkTasks('lazy_rt', cfg, E); assert.deepEqual([t.out.follow, t.out.rt], [false, true]); ok('repost found by paging retweeters');
    env.TWITTERAPI_KEY = 'k';
    r = await req('POST', '/api/claim', { handle: 'nobody2', wallet: '0x' + 'e5'.repeat(20) }, { 'x-forwarded-for': '8.8.8.1' });
    assert.equal(r.code, 409); assert.equal(r.body.error, 'tasks_incomplete'); assert.ok(r.body.message.includes('follow @pray') && r.body.message.includes('repost')); ok('claim blocked until follow + repost: "' + r.body.message + '"');
    r = await req('POST', '/api/claim', { handle: 'doer', wallet: '0x' + 'e6'.repeat(20) }, { 'x-forwarded-for': '8.8.8.2' });
    assert.equal(r.code, 201); assert.equal((await store.get('doer')).tasksVerified, true); ok('claim passes when tasks done, stored as verified');
    env.TWITTERAPI_KEY = ''; cfg.x.account = ''; cfg.x.postId = ''; }

  // referrals
  const H = (ip) => ({ 'x-forwarded-for': ip });
  const WA = '0x' + 'a1'.repeat(20), WB = '0x' + 'b2'.repeat(20), WC = '0x' + 'c3'.repeat(20), WD = '0x' + 'd4'.repeat(20);
  const resBefore = await store.reservedNow();
  r = await req('POST', '/api/claim', { handle: 'apollo', wallet: WA }, H('10.0.0.1')); assert.equal(r.code, 201); assert.equal(r.body.referrals.count, 0);
  r = await req('POST', '/api/claim', { handle: 'hermes', wallet: WB, ref: '@Apollo' }, H('10.0.0.2')); assert.equal(r.code, 201); assert.equal(r.body.refBy, 'apollo');
  const bAmt = r.body.amt;
  r = await req('GET', '/api/claim?handle=apollo'); assert.equal(r.body.referrals.count, 1); assert.equal(r.body.referrals.bonusUsd, Math.floor(bAmt * 10) / 100);
  assert.equal(r.body.totalUsd, Math.round((r.body.amt + r.body.referrals.bonusUsd) * 100) / 100); ok(`referral: apollo earns 10% of hermes ($${bAmt} → +$${r.body.referrals.bonusUsd})`);
  assert.ok(Math.abs((await store.reservedNow()) - resBefore - (0.5 + bAmt + Math.floor(bAmt * 10) / 100)) < 1e-6); ok('referral bonus is counted against the pool');
  r = await req('POST', '/api/claim', { handle: 'ares', wallet: WC, ref: 'apollo' }, H('10.0.0.1')); assert.equal(r.code, 201); assert.equal(r.body.refBy, null); assert.ok(r.body.flags.includes('ref_same_ip')); ok("same-IP referral doesn't pay");
  r = await req('POST', '/api/claim', { handle: 'zeus', wallet: WD, ref: 'zeus' }, H('10.0.0.3')); assert.equal(r.body.refBy, null); ok('self-referral ignored');
  r = await req('GET', '/api/claim?handle=apollo'); assert.equal(r.body.referrals.count, 1); ok('referrer count stays 1');

  // wallet signature (connect + sign)
  { cfg.requireSignature = true;
    const ev = evmSigner(), so = solSigner(), now = () => new Date().toISOString();
    r = await req('POST', '/api/claim', { handle: 'signer_a', wallet: ev.address }, H('20.0.0.1')); assert.equal(r.code, 401); assert.equal(r.body.error, 'signature_required'); ok('claim without signature → 401');
    let at = now(); let sig = ev.sign(claimMessage('signer_a', ev.address, at));
    r = await req('POST', '/api/claim', { handle: 'signer_b', wallet: ev.address, sig, issuedAt: at }, H('20.0.0.1')); assert.equal(r.code, 401); assert.equal(r.body.error, 'bad_signature'); ok('signature for another handle → rejected');
    const other = evmSigner(); sig = other.sign(claimMessage('signer_a', ev.address, at));
    r = await req('POST', '/api/claim', { handle: 'signer_a', wallet: ev.address, sig, issuedAt: at }, H('20.0.0.1')); assert.equal(r.body.error, 'bad_signature'); ok("someone else's wallet signs → rejected (no claiming with a whale's address)");
    const old = new Date(Date.now() - 3600e3).toISOString(); sig = ev.sign(claimMessage('signer_a', ev.address, old));
    r = await req('POST', '/api/claim', { handle: 'signer_a', wallet: ev.address, sig, issuedAt: old }, H('20.0.0.1')); assert.equal(r.body.error, 'expired'); ok('stale signature → expired');
    at = now(); sig = ev.sign(claimMessage('Signer_A', ev.address, at));
    r = await req('POST', '/api/claim', { handle: '@Signer_A', wallet: ev.address.toUpperCase().replace('0X', '0x'), sig, issuedAt: at }, H('20.0.0.1')); assert.equal(r.code, 201, JSON.stringify(r.body)); ok('EVM personal_sign verified → claim created');
    at = now(); sig = so.sign(claimMessage('sol_signer', so.address, at));
    r = await req('POST', '/api/claim', { handle: 'sol_signer', wallet: so.address, chain: 'sol', sig, issuedAt: at }, H('20.0.0.2')); assert.equal(r.code, 201, JSON.stringify(r.body)); ok('Solana signMessage verified → claim created');
    const so2 = solSigner(); sig = so2.sign(claimMessage('sol_signer2', so.address, at));
    r = await req('POST', '/api/claim', { handle: 'sol_signer2', wallet: so.address, chain: 'sol', sig, issuedAt: at }, H('20.0.0.3')); assert.equal(r.body.error, 'bad_signature'); ok('Solana signature from another key → rejected');
    cfg.requireSignature = false; }

  // persistence: totals rebuilt from the records match the running counters
  { const before = await store.pool(); const again = await store.recount();
    assert.equal(again.count, before.count); assert.equal(Math.round(again.reserved * 100), Math.round(before.reserved * 100)); ok(`recount matches running totals (${again.count} claims, $${again.reserved})`); }
  { const fresh = new Store(kv); assert.equal((await fresh.pool()).count, (await store.pool()).count); ok('a new function instance sees the same data'); }

  r = await req('GET', '/api/admin/claims.csv'); assert.equal(r.code, 401);
  r = await req('GET', '/api/admin/claims.csv', null, { authorization: 'Bearer tkn' }); assert.equal(r.code, 200); assert.ok(String(r.body).startsWith('handleDisplay,chain,wallet'));
  assert.equal(String(r.body).split('\n').length - 1, +r.headers.get('x-total-count')); ok('admin CSV export behind token');
  r = await req('GET', '/api/admin/claims.csv?offset=2&limit=3', null, { authorization: 'Bearer tkn' }); assert.equal(String(r.body).split('\n').length, 4); ok('CSV paging');
  r = await req('POST', '/api/admin/rescore', null, { authorization: 'Bearer tkn' }); assert.equal(r.code, 200); assert.equal(r.body.left, 0); ok('rescore endpoint');
  r = await req('GET', '/api/health/'); assert.equal(r.code, 200); ok('trailing slash tolerated');
  { const c = loadConfig({ POOL_CAP_USD: '5000', X_POST_ID: '123', REQUIRE_TASKS: 'false' }); assert.deepEqual([c.pool.capUsd, c.x.postId, c.x.requireTasks, c.x.account], [5000, '123', false, 'prayperpdex']); ok('config from environment variables'); }

  console.log(`\n${n} checks passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

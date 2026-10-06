// Wallet ownership proofs, no dependencies.
//   EVM:    personal_sign (EIP-191) → secp256k1 public key recovery → keccak256 address
//   Solana: signMessage → ed25519 verify (node:crypto)
import crypto from 'node:crypto';

/* ---------- keccak-256 (Ethereum flavour, 0x01 padding) ---------- */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
function keccakF(s) {
  for (let r = 0; r < 24; r++) {
    const C = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) { const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) s[x + y] ^= d; }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & M64 & B[(x + 2) % 5 + 5 * y]);
    s[0] ^= RC[r];
  }
}
export function keccak256(data) {
  const rate = 136, msg = Buffer.from(data);
  const padLen = rate - (msg.length % rate);
  const p = Buffer.concat([msg, Buffer.alloc(padLen)]);
  p[msg.length] ^= 0x01; p[p.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < p.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) s[i] ^= p.readBigUInt64LE(off + i * 8);
    keccakF(s);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i], i * 8);
  return out;
}

/* ---------- secp256k1 ---------- */
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) { let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n]; while (lo > 1n) { const q = hi / lo; [lo, hi] = [hi - q * lo, lo]; [x0, x1] = [x1 - q * x0, x0]; } return mod(x0, m); }
function powm(b, e, m = P) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
// Jacobian coordinates
const J0 = [0n, 1n, 0n];
function jdbl([X, Y, Z]) {
  if (Y === 0n || Z === 0n) return J0;
  const S = mod(4n * X * Y * Y), M = mod(3n * X * X), X3 = mod(M * M - 2n * S);
  return [X3, mod(M * (S - X3) - 8n * Y ** 4n), mod(2n * Y * Z)];
}
function jadd(A, B) {
  if (A[2] === 0n) return B; if (B[2] === 0n) return A;
  const [X1, Y1, Z1] = A, [X2, Y2, Z2] = B;
  const Z1Z1 = mod(Z1 * Z1), Z2Z2 = mod(Z2 * Z2);
  const U1 = mod(X1 * Z2Z2), U2 = mod(X2 * Z1Z1), S1 = mod(Y1 * Z2 * Z2Z2), S2 = mod(Y2 * Z1 * Z1Z1);
  if (U1 === U2) return S1 === S2 ? jdbl(A) : J0;
  const H = mod(U2 - U1), R = mod(S2 - S1), H2 = mod(H * H), H3 = mod(H * H2), V = mod(U1 * H2);
  const X3 = mod(R * R - H3 - 2n * V);
  return [X3, mod(R * (V - X3) - S1 * H3), mod(H * Z1 * Z2)];
}
function jmul(Pt, k) { let R = J0, Q = [Pt[0], Pt[1], 1n]; while (k > 0n) { if (k & 1n) R = jadd(R, Q); Q = jdbl(Q); k >>= 1n; } return R; }
function affine([X, Y, Z]) { if (Z === 0n) return null; const zi = inv(Z), zi2 = mod(zi * zi); return [mod(X * zi2), mod(Y * zi2 * zi)]; }
export const pointMul = (k, Pt = G) => affine(jmul(Pt, mod(k, N)));
const big = (b) => BigInt('0x' + (Buffer.from(b).toString('hex') || '0'));
const hex32 = (n) => n.toString(16).padStart(64, '0');

export function addressOfPub([x, y]) { return '0x' + keccak256(Buffer.from(hex32(x) + hex32(y), 'hex')).subarray(12).toString('hex'); }

export function ecrecover(hash, r, s, recId) {
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const x = r + (recId & 2 ? N : 0n); if (x >= P) return null;
  let y = powm(mod(x ** 3n + 7n), (P + 1n) / 4n);
  if (mod(y * y) !== mod(x ** 3n + 7n)) return null;
  if ((y & 1n) !== BigInt(recId & 1)) y = P - y;
  const e = big(hash), ri = inv(r, N);
  const Q = affine(jadd(jmul([x, y], mod(s * ri, N)), jmul(G, mod(-e * ri, N))));
  return Q;
}

export const personalHash = (msg) => { const m = Buffer.from(msg, 'utf8'); return keccak256(Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n' + m.length, 'utf8'), m])); };

export function verifyEvm(msg, sigHex, address) {
  const sig = Buffer.from(String(sigHex || '').replace(/^0x/, ''), 'hex');
  if (sig.length !== 65) return false;
  const r = big(sig.subarray(0, 32)), s = big(sig.subarray(32, 64)); let v = sig[64];
  if (v >= 27) v -= 27;
  if (v > 3) return false;
  const Q = ecrecover(personalHash(msg), r, s, v);
  return !!Q && addressOfPub(Q) === String(address).toLowerCase();
}

/* ---------- Solana ---------- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58decode(str) {
  let n = 0n; for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const hex = n === 0n ? '' : n.toString(16); const body = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  let zeros = 0; while (str[zeros] === '1') zeros++;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}
const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
export function verifySol(msg, sigB64, address) {
  try {
    const pub = b58decode(address); if (pub.length !== 32) return false;
    const sig = Buffer.from(String(sigB64 || ''), 'base64'); if (sig.length !== 64) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, pub]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(msg, 'utf8'), key, sig);
  } catch { return false; }
}

/* ---------- claim message ---------- */
// The site asks the wallet to sign exactly this text; the server rebuilds it and checks the signature.
export const claimMessage = (handle, wallet, issuedAt) =>
  `PRAY offering\n\nI own this wallet and claim the offering for @${handle}.\n\nWallet: ${wallet}\nIssued: ${issuedAt}\n\nThis signature is free. It does not move funds or approve anything.`;

export function verifyClaimSig({ handle, wallet, chain, sig, issuedAt }, maxAgeMs = 15 * 60e3) {
  const t = Date.parse(issuedAt || '');
  if (!t || Math.abs(Date.now() - t) > maxAgeMs) return { ok: false, reason: 'expired' };
  const msg = claimMessage(handle, wallet, issuedAt);
  const ok = chain === 'sol' ? verifySol(msg, sig, wallet) : verifyEvm(msg, sig, wallet);
  return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

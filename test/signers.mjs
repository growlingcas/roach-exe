// Test-only wallet signers: EVM personal_sign (secp256k1 + EIP-191) and Solana signMessage (ed25519).
import crypto from 'node:crypto';
import { pointMul, addressOfPub, personalHash } from '../netlify/lib/sig.mjs';

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const mod = (a) => ((a % N) + N) % N;
const inv = (a) => { let [lo, hi, x0, x1] = [mod(a), N, 1n, 0n]; while (lo > 1n) { const q = hi / lo; [lo, hi] = [hi - q * lo, lo]; [x0, x1] = [x1 - q * x0, x0]; } return mod(x0); };
const rnd = () => mod(BigInt('0x' + crypto.randomBytes(32).toString('hex'))) || 1n;
const h64 = (n) => n.toString(16).padStart(64, '0');

export function evmSigner() {
  const d = rnd(); const address = addressOfPub(pointMul(d));
  return {
    address,
    sign(msg) {
      const e = BigInt('0x' + personalHash(msg).toString('hex'));
      for (;;) {
        const k = rnd(); const R = pointMul(k); const r = mod(R[0]); if (!r) continue;
        let s = mod(inv(k) * (e + r * d)); if (!s) continue;
        let rec = Number(R[1] & 1n); if (s > N / 2n) { s = N - s; rec ^= 1; }
        return '0x' + h64(r) + h64(s) + (27 + rec).toString(16);
      }
    },
  };
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) { let n = BigInt('0x' + buf.toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b) break; s = '1' + s; } return s; }

export function solSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { address: b58encode(raw), sign: (msg) => crypto.sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('base64') };
}

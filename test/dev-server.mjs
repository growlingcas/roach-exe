// Local preview with stubbed data sources and an in-memory store: node test/dev-server.mjs → http://127.0.0.1:8790
// (For a run against the real APIs and real Netlify Blobs use `netlify dev` from the Netlify CLI.)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { X_LIKES } from './stubs.mjs';
import { createApi } from '../netlify/lib/core.mjs';
import { Store, MemKV } from '../netlify/lib/store.mjs';
import { loadConfig } from '../netlify/lib/config.mjs';
import { evmSigner, solSigner } from './signers.mjs';

// dev-only test wallets so a browser test can sign without a real extension: GET /__dev/wallet, POST /__dev/sign {chain, msg}
const DEV = { evm: evmSigner(), sol: solSigner() };

const PUB = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const env = { HELIUS_API_KEY: 'stub', ADMIN_TOKEN: 'dev', ...(process.env.DEV_X ? { X_CONSUMER_KEY: 'ck', X_CONSUMER_SECRET: 'cs', SESSION_SECRET: 'dev' } : {}) };
const cfg = loadConfig({}); cfg.x.postId = process.env.DEV_X ? '777' : '';
const api = createApi({ store: new Store(new MemKV()), cfg, env });
const port = +(process.env.PORT || 8790);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + port);
  if (process.env.DEV_LOG) console.log('IN', req.method, url.pathname, Date.now() % 100000);
  if (url.pathname.startsWith('/__dev/')) {
    let body = ''; for await (const c of req) body += c;
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/__dev/like') { X_LIKES.add('4242'); return res.end('{"ok":true}'); }
    if (url.pathname === '/__dev/wallet') return res.end(JSON.stringify({ evm: DEV.evm.address, sol: DEV.sol.address }));
    const { chain, msg } = JSON.parse(body || '{}'); return res.end(JSON.stringify({ sig: DEV[chain === 'sol' ? 'sol' : 'evm'].sign(msg) }));
  }
  if (url.pathname.startsWith('/api/')) {
    let body = ''; for await (const c of req) body += c;
    if (process.env.DEV_LOG) console.log(req.method, url.pathname, JSON.stringify(req.headers));
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body }), req.socket.remoteAddress);
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(path.join(PUB, 'index.html')).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('PRAY dev server (stubbed sources) on http://127.0.0.1:' + port));

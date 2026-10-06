// Netlify Function: every /api/* request of the PRAY site.
import { createApi } from '../lib/core.mjs';
import { Store } from '../lib/store.mjs';
import { BlobKV } from '../lib/blobs.mjs';
import { loadConfig } from '../lib/config.mjs';

let api;
export default async (req, context) => {
  if (!api) api = createApi({ store: new Store(new BlobKV()), cfg: loadConfig(process.env), env: process.env });
  const ip = context.ip || (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '?').split(',')[0].trim();
  return api(req, ip);
};

export const config = { path: '/api/*' };

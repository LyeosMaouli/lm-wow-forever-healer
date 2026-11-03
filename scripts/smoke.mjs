import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:3000';
const url = new URL(base);
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('SMOKE_URL must use http or https');
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try { const r = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(1500) }); if (r.ok && (await r.json()).status === 'ok') { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert(ready, 'Server was not ready within the smoke-test window');
for (const [path, type] of [['/', 'text/html'], ['/app.js', 'javascript'], ['/data.js', 'javascript'], ['/style.css', 'text/css'], ['/assets/forever.jpg', 'image/jpeg']]) {
  const r = await fetch(new URL(path, base), { signal: AbortSignal.timeout(3000) });
  assert.equal(r.status, 200, path); assert(r.headers.get('content-type')?.includes(type), path);
  if (path === '/') assert((await r.text()).includes('Fun is'));
}
const missing = await fetch(new URL('/missing-file.js', base));
assert.equal(missing.status, 404);
console.log('HTTP smoke tests passed.');

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer } from '../server.mjs';
let temporary, root, app, port;
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers ?? {} }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'forever-healing-'));
  root = join(temporary, 'public'); await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Guide</title>Fun is BiS');
  await writeFile(join(root, 'app.js'), 'console.log("guide");');
  await writeFile(join(root, 'assets', 'test.jpg'), 'image-bytes');
  await writeFile(join(temporary, 'secret.txt'), 'outside-root-secret');
  app = await createWebServer({ root, version: 'test-version', logLevel: 'silent' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  port = app.server.address().port;
});
after(async () => { if (app) await app.shutdown(); if (temporary) await rm(temporary, { recursive: true, force: true }); });

test('serves the actual HTML with security headers', async () => {
  const r = await request('/'); assert.equal(r.status, 200); assert.match(r.body, /Fun is BiS/);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.headers['content-security-policy'], /script-src 'self'/);
});
test('HEAD returns the same metadata without the body', async () => {
  const get = await request('/'), head = await request('/', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.body, ''); assert.equal(head.headers['content-length'], get.headers['content-length']);
});
test('serves JavaScript and query strings, but missing assets stay 404', async () => {
  const js = await request('/app.js?v=123'); assert.equal(js.status, 200); assert.match(js.headers['content-type'], /javascript/);
  assert.equal((await request('/does-not-exist.js')).status, 404);
  assert.equal((await request('/assets/')).status, 404);
});
test('rejects unsupported methods without serving the page', async () => {
  const r = await request('/', { method: 'POST' }); assert.equal(r.status, 405); assert.equal(r.headers.allow, 'GET, HEAD');
});
test('blocks traversal, dotfiles and malformed paths', async () => {
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/.env', '/.git/config']) {
    const r = await request(path); assert.equal(r.status, 403, path); assert(!r.body.includes('outside-root-secret'));
  }
  for (const path of ['/%zz', '/%00', '/assets%5c..%5csecret.txt']) assert.equal((await request(path)).status, 400, path);
});
test('a symlink cannot expose a file outside the static root', async t => {
  try { await symlink(join(temporary, 'secret.txt'), join(root, 'link.txt')); }
  catch (e) { if (e.code === 'EPERM' && process.platform === 'win32') { t.skip('Windows does not permit creating symlinks'); return; } throw e; }
  const r = await request('/link.txt'); assert.equal(r.status, 403); assert(!r.body.includes('outside-root-secret'));
});
test('ETag revalidation and asset caching work', async () => {
  const first = await request('/assets/test.jpg'); assert.equal(first.status, 200); assert.match(first.headers['content-type'], /image\/jpeg/);
  assert.equal(first.headers['cache-control'], 'public, max-age=86400');
  const cached = await request('/assets/test.jpg', { headers: { 'If-None-Match': first.headers.etag } });
  assert.equal(cached.status, 304); assert.equal(cached.body, '');
  assert.equal((await request('/')).headers['cache-control'], 'public, max-age=0, must-revalidate');
});
test('health endpoints expose readiness and version without caching', async () => {
  for (const path of ['/healthz', '/readyz', '/livez']) {
    const r = await request(path); assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.body), { status: 'ok', version: 'test-version' });
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal((await request('/healthz', { method: 'HEAD' })).body, '');
});
test('readiness fails when the index disappears, liveness stays available', async () => {
  await rm(join(root, 'index.html'));
  try { assert.equal((await request('/healthz')).status, 503); assert.equal((await request('/readyz')).status, 503); assert.equal((await request('/livez')).status, 200); }
  finally { await writeFile(join(root, 'index.html'), '<!doctype html><title>Guide</title>Fun is BiS'); }
});
test('startup rejects a missing static directory', async () => {
  await assert.rejects(createWebServer({ root: join(temporary, 'missing') }), { code: 'ENOENT' });
});

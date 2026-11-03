import http from 'node:http';
import { readFile, realpath, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('.', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // The original UI uses dynamic inline style attributes for class colours/tooltips.
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
};

/** Serve only the supplied static root. No runtime dependencies or writes. */
export async function createWebServer({ root = resolve(projectDir, 'dist'), version = 'local', logLevel = 'info' } = {}) {
  const staticRoot = await realpath(root);
  const indexPath = resolve(staticRoot, 'index.html');
  await access(indexPath);
  let draining = false;
  const server = http.createServer({ requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 }, async (req, res) => {
    const started = performance.now();
    let pathname = '';
    const send = (status, body, contentType = 'text/plain; charset=utf-8', headers = {}) => {
      const bytes = Buffer.from(body);
      res.writeHead(status, { ...securityHeaders, 'Content-Type': contentType, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', ...headers });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    try {
      const raw = (req.url ?? '/').split('?')[0];
      if (!raw.startsWith('/')) return send(400, 'Bad request\n');
      try { pathname = decodeURIComponent(raw); } catch { return send(400, 'Bad request\n'); }
      if (pathname.includes('\0') || pathname.includes('\\')) return send(400, 'Bad request\n');
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed\n', undefined, { Allow: 'GET, HEAD' });
      if (['/healthz', '/readyz', '/livez'].includes(pathname)) {
        let ready = !draining;
        if (pathname !== '/livez') {
          try { await access(indexPath); } catch { ready = false; }
        }
        return send(ready ? 200 : 503, JSON.stringify({ status: ready ? 'ok' : 'unavailable', version }) + '\n', 'application/json; charset=utf-8');
      }
      const segments = pathname.split('/');
      if (segments.some(segment => segment === '..' || segment.startsWith('.'))) return send(403, 'Forbidden\n');
      const requested = resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      const file = await realpath(requested);
      const inside = relative(staticRoot, file);
      if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) return send(403, 'Forbidden\n');
      if (!(await stat(file)).isFile()) return send(404, 'Not found\n');
      const bytes = await readFile(file);
      const etag = '"' + createHash('sha256').update(bytes).digest('base64url') + '"';
      const cacheControl = pathname.startsWith('/assets/') ? 'public, max-age=86400' : 'public, max-age=0, must-revalidate';
      const headers = { ...securityHeaders, ETag: etag, 'Cache-Control': cacheControl, 'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream' };
      const incoming = (req.headers['if-none-match'] ?? '').split(',').map(s => s.trim().replace(/^W\//, ''));
      if (incoming.includes(etag) || incoming.includes('*')) {
        res.writeHead(304, headers); return res.end();
      }
      res.writeHead(200, { ...headers, 'Content-Length': bytes.length });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return send(404, 'Not found\n');
      if (!['silent'].includes(logLevel)) console.error(JSON.stringify({ level: 'error', message: 'request_failed', code: error.code ?? 'INTERNAL' }));
      if (!res.headersSent) send(500, 'Internal server error\n'); else res.destroy();
    } finally {
      if (logLevel === 'info' && !['/healthz', '/readyz', '/livez'].includes(pathname)) {
        res.once('finish', () => console.log(JSON.stringify({ level: 'info', method: req.method, path: pathname, status: res.statusCode, durationMs: Math.round(performance.now() - started) })));
      }
    }
  });
  server.maxHeadersCount = 100;
  function shutdown() {
    draining = true;
    return new Promise((resolveClose, rejectClose) => {
      const timer = setTimeout(() => server.closeAllConnections(), 10_000);
      timer.unref();
      server.close(error => { clearTimeout(timer); error ? rejectClose(error) : resolveClose(); });
    });
  }
  return { server, shutdown };
}

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  const logLevel = process.env.LOG_LEVEL ?? 'info';
  if (!['info', 'error', 'silent'].includes(logLevel)) throw new Error('LOG_LEVEL must be info, error or silent');
  const root = resolve(projectDir, process.argv.includes('--dev') ? 'public' : 'dist');
  const app = await createWebServer({ root, version: process.env.APP_VERSION ?? 'local', logLevel });
  await new Promise((resolveListen, rejectListen) => {
    app.server.once('error', rejectListen);
    app.server.listen(port, process.env.HOST ?? '0.0.0.0', resolveListen);
  });
  console.log(JSON.stringify({ level: 'info', message: 'server_started', port, mode: process.argv.includes('--dev') ? 'development' : 'production' }));
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    try { await app.shutdown(); process.exitCode = 0; } catch (error) { console.error(error.message); process.exitCode = 1; }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Startup failed: ' + error.message + '. Run npm run build before npm start.'); process.exitCode = 1; });
}

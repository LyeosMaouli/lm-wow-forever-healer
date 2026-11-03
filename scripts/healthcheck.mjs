import http from 'node:http';
const req = http.get({ hostname: '127.0.0.1', port: Number(process.env.PORT ?? 3000), path: '/healthz', timeout: 3000 }, res => {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', chunk => { text += chunk; });
  res.on('end', () => {
    try { process.exitCode = res.statusCode === 200 && JSON.parse(text).status === 'ok' ? 0 : 1; } catch { process.exitCode = 1; }
  });
});
req.on('timeout', () => req.destroy(new Error('Health check timed out')));
req.on('error', error => { console.error(error.message); process.exitCode = 1; });

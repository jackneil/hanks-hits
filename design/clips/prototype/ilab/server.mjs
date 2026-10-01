// Temporary iPhone lab server for the gameplay-clips Phase 0 spike.
// Serves the capability probe (/probe), the prior prototypes (/proto/*) and the
// capture-path lab (/ilab/*) behind a per-session token cookie, with the same
// CSP production sends, and saves every POSTed result under ./out.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const PORT = 8790;
const TOKEN = process.env.LAB_TOKEN || crypto.randomBytes(12).toString('hex');
const OUT = '/tmp/hh-clips/ilab/out';
const roots = { '/proto/': '/tmp/hh-clips/proto', '/ilab/': '/tmp/hh-clips/ilab' };
const probe = {
  '/probe': ['/tmp/hh-clips/probe/probe.html', 'text/html'],
  '/probe.js': ['/tmp/hh-clips/probe/probe.js', 'text/javascript'],
  '/worker.js': ['/tmp/hh-clips/probe/worker.js', 'text/javascript'],
  '/worklet.js': ['/tmp/hh-clips/probe/worklet.js', 'text/javascript'],
  '/mediabunny.mjs': ['/tmp/hh-clips/node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', 'text/javascript'],
  '/aac.mjs': ['/tmp/hh-clips/node_modules/@mediabunny/aac-encoder/dist/bundles/mediabunny-aac-encoder.min.mjs', 'text/javascript'],
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' https:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none';";
const sec = { 'Content-Security-Policy': CSP, 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
const hasToken = (req) => (req.headers.cookie || '').split(';').some((c) => c.trim() === 'hhlab=' + TOKEN);
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/go/' + TOKEN) {
    res.writeHead(302, { ...sec, 'Set-Cookie': `hhlab=${TOKEN}; Path=/; Secure; HttpOnly; SameSite=Lax`, Location: '/ilab/' });
    return res.end();
  }
  if (!hasToken(req)) { res.writeHead(404, sec); return res.end('nf'); }
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const raw = u.searchParams.get('name') || u.searchParams.get('label') || 'blob';
      const extra = u.searchParams.get('name') && u.searchParams.get('label') ? '-' + u.searchParams.get('name') : '';
      const name = (u.pathname.slice(1) + '-' + raw + extra).replace(/[^A-Za-z0-9_.-]/g, '_');
      fs.writeFileSync(path.join(OUT, name), buf);
      console.log(new Date().toISOString(), 'saved', name, buf.length);
      res.writeHead(200, { ...sec, 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  if (probe[u.pathname]) {
    const [f, t] = probe[u.pathname];
    res.writeHead(200, { ...sec, 'Content-Type': t });
    return fs.createReadStream(f).pipe(res);
  }
  if (u.pathname === '/') { res.writeHead(302, { ...sec, Location: '/ilab/' }); return res.end(); }
  for (const [pre, dir] of Object.entries(roots)) {
    if (u.pathname.startsWith(pre)) {
      const rel = u.pathname.slice(pre.length) || 'index.html';
      const p = path.join(dir, rel);
      if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) break;
      res.writeHead(200, { ...sec, 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      return fs.createReadStream(p).pipe(res);
    }
  }
  res.writeHead(404, sec); res.end('nf');
}).listen(PORT, '127.0.0.1', () => console.log('lab on', PORT, 'token', TOKEN));
